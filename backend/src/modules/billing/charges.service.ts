import { HttpStatus, Injectable } from '@nestjs/common';
import { DamageChargeStatus, InvoiceKind, InvoiceLineType, Prisma } from '@prisma/client';
import { DomainException, ErrorCode } from '../../common/errors';
import { ParameterService } from '../platform/parameters/parameter.service';
import { DamageChargeRow, DamageChargesRepository } from './damage-charges.repository';
import { InvoiceRow, InvoicesRepository, LineRow, NewInvoiceLine } from './invoices.repository';
import { PricingService } from './pricing.service';

export interface ChargedContract {
  id: string;
  organizationId: string;
}

export interface LateContract extends ChargedContract {
  returnDueAt: Date;
}

export interface ChargedDevice {
  id: string;
  assetTag: string;
}

// A DAMAGED inspection as `rentals` passes it after check-in (REQ-EVT-05).
export interface DamagedInspection {
  id: string;
  deviceId: string;
  assetTag: string;
  hardwareVariantId: string;
  damageCodes: readonly string[];
}

export interface DamageResult {
  charge: DamageChargeRow;
  // The closing invoice when the charge was approved at once; null while it waits for an Admin.
  invoice: InvoiceRow | null;
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

const unpaidOf = (lines: readonly LineRow[]): bigint =>
  lines.reduce(
    (total, line) =>
      line.amountVnd > line.paidVnd ? total + line.amountVnd - line.paidVnd : total,
    0n,
  );

// Charges outside the plan, on the contract's closing invoice (billing design §1 and §2): the
// cancellation adjustment (task 2.3), late fees and damage charges (task 2.5), and loss charges with
// their adjustments (task 2.6).
@Injectable()
export class ChargesService {
  constructor(
    private readonly invoices: InvoicesRepository,
    private readonly damageCharges: DamageChargesRepository,
    private readonly pricing: PricingService,
    private readonly parameters: ParameterService,
  ) {}

  // A contract cancelled before handover (REQ-EVT-11, FR-CON-04, E01-7): the unpaid lines of its
  // first invoice are voided by one ADJUSTMENT line of the opposite amount on the closing invoice,
  // so the balance nets to zero while a paid holding fee stays paid and retained. Issued lines never
  // change (REQ-UBI-02). Returns the closing invoice, or null when nothing was unpaid or no invoice
  // was issued yet (a cancellation from REQUESTED). `actorId` is null for SYSTEM.
  async settleCancellation(
    contract: ChargedContract,
    actorId: string | null,
    tx: Prisma.TransactionClient,
    at: Date = new Date(),
  ): Promise<InvoiceRow | null> {
    const first = await this.invoices.firstChargeableInvoice(contract.id, tx);
    if (!first) return null;
    const unpaid = unpaidOf(first.lines);
    if (unpaid === 0n) return null;

    return this.addToClosing(
      contract,
      {
        type: InvoiceLineType.ADJUSTMENT,
        description: `Cancellation before handover: voids the unpaid lines of ${first.number}`,
        quantity: 1,
        unitVnd: -unpaid,
        amountVnd: -unpaid,
        dueAt: at,
        createdById: actorId,
      },
      tx,
      at,
    );
  }

  // A device checked in after `returnDueAt` plus `rentals.returnGraceHours` (REQ-EVT-04, FR-BILL-03,
  // BR-23): one LATE_FEE line for that device of `billing.lateFeePerDevicePerDayVnd` per started day
  // after the due time, on the closing invoice. Within the grace nothing is charged and null is
  // returned. Called by `rentals` once per device at check-in, inside its transaction.
  async chargeLate(
    contract: LateContract,
    device: ChargedDevice,
    checkedInAt: Date,
    actorId: string | null,
    tx: Prisma.TransactionClient,
  ): Promise<InvoiceRow | null> {
    const [graceHours, feePerDay] = await Promise.all([
      this.parameters.get('rentals.returnGraceHours', tx),
      this.parameters.get('billing.lateFeePerDevicePerDayVnd', tx),
    ]);
    const lateMs = checkedInAt.getTime() - contract.returnDueAt.getTime();
    if (lateMs <= graceHours * HOUR_MS) return null;

    const days = Math.ceil(lateMs / DAY_MS);
    const unitVnd = BigInt(feePerDay);
    return this.addToClosing(
      contract,
      {
        type: InvoiceLineType.LATE_FEE,
        description: `Late return of ${device.assetTag}, ${days} day${days === 1 ? '' : 's'}`,
        deviceId: device.id,
        quantity: days,
        unitVnd,
        amountVnd: unitVnd * BigInt(days),
        dueAt: checkedInAt,
        createdById: actorId,
      },
      tx,
      checkedInAt,
    );
  }

  // A DAMAGED inspection (REQ-EVT-05, FR-BILL-04, BR-24): each damage code is priced from the
  // schedule, the variant's own rate first and the generic rate otherwise, into one DamageCharge.
  // Above `billing.damageApprovalThresholdVnd` it waits for an Admin (PENDING_APPROVAL); at or below
  // it is APPROVED at once and becomes a DAMAGE line on the closing invoice. A code with no active
  // rate is 400 UNKNOWN_DAMAGE_CODE and records nothing. Null for an inspection without damage codes.
  // The charge stores its contract, its inspector and its codes (D-081), so the Admin decision
  // (UC-48) needs no read from `rentals` or `devices`.
  async chargeDamage(
    contract: ChargedContract,
    inspection: DamagedInspection,
    inspectorId: string,
    tx: Prisma.TransactionClient,
    at: Date = new Date(),
  ): Promise<DamageResult | null> {
    if (inspection.damageCodes.length === 0) return null;

    let totalVnd = 0n;
    for (const code of inspection.damageCodes) {
      const amount = await this.pricing.damageRateFor(code, inspection.hardwareVariantId, tx);
      if (amount === null) {
        // rentals api-design 16: a code with no active rate is unknown to the price list.
        throw new DomainException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.UNKNOWN_DAMAGE_CODE,
          `Unknown damage code: ${code}.`,
        );
      }
      totalVnd += amount;
    }

    const threshold = BigInt(await this.parameters.get('billing.damageApprovalThresholdVnd', tx));
    const approved = totalVnd <= threshold;
    const charge = await this.damageCharges.insert(
      {
        inspectionId: inspection.id,
        deviceId: inspection.deviceId,
        contractId: contract.id,
        inspectorId,
        damageCodes: [...inspection.damageCodes],
        amountVnd: totalVnd,
        status: approved ? DamageChargeStatus.APPROVED : DamageChargeStatus.PENDING_APPROVAL,
        finalVnd: approved ? totalVnd : null,
        decidedAt: approved ? at : null,
      },
      tx,
    );
    if (!approved) return { charge, invoice: null };

    const invoice = await this.addToClosing(
      contract,
      {
        type: InvoiceLineType.DAMAGE,
        description: `Damage to ${inspection.assetTag}: ${inspection.damageCodes.join(', ')}`,
        deviceId: inspection.deviceId,
        quantity: 1,
        unitVnd: totalVnd,
        amountVnd: totalVnd,
        dueAt: at,
        createdById: inspectorId,
      },
      tx,
      at,
    );
    return { charge, invoice };
  }

  // A loss confirmed in RENTER custody (REQ-EVT-07, FR-BILL-05, BR-25): one LOSS line of the device's
  // remaining value at the confirmation date on the contract's closing invoice. `valueVnd` comes from
  // `devices.valueAt` through the loss-case listener; a device with no value left adds nothing.
  async chargeLoss(
    contract: ChargedContract,
    device: ChargedDevice,
    valueVnd: number,
    lossCaseCode: string,
    confirmedAt: Date,
    tx: Prisma.TransactionClient,
  ): Promise<InvoiceRow | null> {
    const amount = BigInt(Math.round(valueVnd));
    if (amount <= 0n) return null;
    return this.addToClosing(
      contract,
      {
        type: InvoiceLineType.LOSS,
        description: `Loss of ${device.assetTag} (${lossCaseCode}): remaining value`,
        deviceId: device.id,
        quantity: 1,
        unitVnd: amount,
        amountVnd: amount,
        dueAt: confirmedAt,
        createdById: null,
      },
      tx,
      confirmedAt,
    );
  }

  // A loss settled as reduced or waived (FR-BILL-11, BR-39): an ADJUSTMENT line of the difference
  // between the LOSS line and the decided amount, with the reason and its author; the LOSS line itself
  // never changes. Null when nothing was charged for the device or nothing is taken back.
  async adjustLoss(
    contract: ChargedContract,
    device: ChargedDevice,
    decision: 'REDUCED' | 'WAIVED',
    finalVnd: number,
    reason: string,
    actorId: string | null,
    tx: Prisma.TransactionClient,
    at: Date = new Date(),
  ): Promise<InvoiceRow | null> {
    const loss = await this.invoices.lossLine(contract.id, device.id, tx);
    if (!loss) return null;
    const kept = decision === 'WAIVED' ? 0n : BigInt(Math.round(Math.max(finalVnd, 0)));
    const back = loss.amountVnd - (kept < loss.amountVnd ? kept : loss.amountVnd);
    if (back <= 0n) return null;
    return this.addToClosing(
      contract,
      {
        type: InvoiceLineType.ADJUSTMENT,
        description: `Loss of ${device.assetTag} ${decision === 'WAIVED' ? 'waived' : 'reduced'}: ${reason}`,
        deviceId: device.id,
        quantity: 1,
        unitVnd: -back,
        amountVnd: -back,
        dueAt: at,
        createdById: actorId,
      },
      tx,
      at,
    );
  }

  // The contract's damage charges still waiting for an Admin decision: they have no invoice line yet,
  // so the lines alone do not show them (rentals api-design 17 close guard, D-081).
  async pendingDamage(contractId: string, tx: Prisma.TransactionClient): Promise<number> {
    return (await this.damageCharges.pendingOfContract(contractId, tx)).length;
  }

  // The Admin decision on a charge above the threshold (UC-48, api-design 17, FR-BILL-04, BR-24): an
  // approved or reduced amount becomes a DAMAGE line on the contract's closing invoice; a waiver adds
  // nothing. The caller holds the charge lock and has checked the state and the approver.
  async addDecidedDamage(
    contract: ChargedContract,
    charge: { deviceId: string; damageCodes: readonly string[] },
    assetTag: string,
    amountVnd: bigint,
    actorId: string,
    tx: Prisma.TransactionClient,
    at: Date,
  ): Promise<InvoiceRow | null> {
    if (amountVnd <= 0n) return null;
    return this.addToClosing(
      contract,
      {
        type: InvoiceLineType.DAMAGE,
        description: `Damage to ${assetTag}: ${charge.damageCodes.join(', ')}`,
        deviceId: charge.deviceId,
        quantity: 1,
        unitVnd: amountVnd,
        amountVnd,
        dueAt: at,
        createdById: actorId,
      },
      tx,
      at,
    );
  }

  // Appends the line to the contract's closing invoice, created with it on the first charge (design
  // §1: one CLOSING invoice per contract, serialized by lockClosingInvoice).
  private async addToClosing(
    contract: ChargedContract,
    line: NewInvoiceLine,
    tx: Prisma.TransactionClient,
    at: Date,
  ): Promise<InvoiceRow> {
    const closing = await this.invoices.lockClosingInvoice(contract.id, tx);
    if (closing) return this.invoices.appendLines(closing, [line], tx);
    return this.invoices.insert(
      {
        organizationId: contract.organizationId,
        contractId: contract.id,
        termId: null,
        kind: InvoiceKind.CLOSING,
        issuedAt: at,
      },
      [line],
      tx,
    );
  }
}
