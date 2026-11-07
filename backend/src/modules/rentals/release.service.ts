import { HttpStatus, Injectable } from '@nestjs/common';
import { ContractStatus, PlanType, Prisma, ReleasePhase } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { ChargesService, releaseCreditQuote, ServiceCreditService } from '../billing';
import { DevicesService } from '../devices';
import { AUDIT_RECORD, AuditRecordEvent } from '../platform/audit/audit-record.event';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ContractRow, ContractsRepository } from './contracts.repository';
import { CustodyService } from './custody.service';
import { DEVICE_CHECKED_IN, DeviceCheckedInEvent } from './return.service';

export const CONTRACT_UNIT_RELEASED = 'contract.unitReleased';

const REASON_MAX = 500;
const BEFORE_HANDOVER: readonly ContractStatus[] = [
  ContractStatus.REQUESTED,
  ContractStatus.APPROVED,
];
const RUNNING: readonly ContractStatus[] = [ContractStatus.ACTIVE, ContractStatus.ENDING];

export interface ReleaseCreditView {
  applies: boolean;
  unusedDays: number;
  termDays: number;
  computedVnd: bigint;
}

export interface ReleasePreview {
  phase: ReleasePhase;
  quantityBefore: number;
  quantityAfter: number;
  lastUnit: boolean;
  credit: ReleaseCreditView | null;
  firstInvoice: {
    totalVnd: bigint;
    paidVnd: bigint;
    newTotalVnd: bigint;
    owedToOrganizationVnd: bigint;
  } | null;
}

export interface Released {
  release: {
    id: string;
    contractId: string;
    deviceId: string;
    phase: ReleasePhase;
    reason: string;
    releasedAt: Date;
    quantityBefore: number;
    quantityAfter: number;
    serviceCreditId: string | null;
  };
  contract: { id: string; quantity: number; version: number };
  credit: {
    id: string;
    kind: string;
    status: string;
    computedVnd: bigint;
    unusedDays: number;
    termDays: number;
  } | null;
  firstInvoiceLoweredByVnd: bigint | null;
}

const conflict = (code: ErrorCode, message: string) =>
  new DomainException(HttpStatus.CONFLICT, code, message);

const invalidReason = () =>
  new DomainException(
    HttpStatus.BAD_REQUEST,
    ErrorCode.VALIDATION_FAILED,
    `reason must be 1 to ${REASON_MAX} characters.`,
  );

const planOf = (contract: ContractRow): 'MONTHLY' | 'DAY' =>
  contract.planType === PlanType.DAY ? 'DAY' : 'MONTHLY';

// Release a unit (rentals task 13.2, REQ-EVT-31 to REQ-EVT-33, REQ-ERR-19, REQ-ERR-20, design §13, D-099):
// TrekLink Staff give one unit back before the term end. A handed-over unit is back at the counter, so
// its custody row closes RELEASED (stamped checked in), the unit goes RETURNED for its reset and
// inspection, and a monthly contract with an open term asks billing for a release credit the Admin
// decides. A held unit before the handover goes back to AVAILABLE and the first invoice is lowered.
// Either way the quantity drops by one; the minimum order quantity is not checked; the last unit is
// refused.
@Injectable()
export class ReleaseService {
  constructor(
    private readonly contracts: ContractsRepository,
    private readonly custody: CustodyService,
    private readonly devices: DevicesService,
    private readonly charges: ChargesService,
    private readonly credits: ServiceCreditService,
    private readonly events: TransactionalEvents,
  ) {}

  // The guards of REQ-ERR-20 in their order (reason, state, version, unit, last unit), shared by the
  // release and its preview; the preview passes no reason or version.
  private async guard(
    contract: ContractRow,
    deviceId: string,
    tx: Prisma.TransactionClient,
    check: { reason?: string; expectedVersion?: number },
  ) {
    if (check.reason !== undefined) {
      if (check.reason.length === 0 || check.reason.length > REASON_MAX) throw invalidReason();
    }
    const running = RUNNING.includes(contract.status);
    if (!running && !BEFORE_HANDOVER.includes(contract.status)) {
      throw conflict(
        ErrorCode.INVALID_STATE_TRANSITION,
        `This cannot be done while it is ${contract.status}.`,
      );
    }
    if (check.expectedVersion !== undefined && contract.version !== check.expectedVersion) {
      throw conflict(
        ErrorCode.STALE_VERSION,
        'Someone else changed this. Reload to see the latest.',
      );
    }
    const rows = running
      ? await this.contracts.rowsOut(contract.id, tx)
      : (await this.contracts.liveRows(contract.id, tx)).filter((row) => row.handedOverAt === null);
    const row = rows.find((candidate) => candidate.deviceId === deviceId);
    if (!row) {
      const tags = await this.devices.assetTags([deviceId], tx);
      throw conflict(
        ErrorCode.DEVICE_NOT_ON_CONTRACT,
        `${tags.get(deviceId) ?? 'This device'} does not belong to contract ${contract.code}.`,
      );
    }
    const lastUnit = rows.length <= 1;
    return { running, row, lastUnit };
  }

  private lastUnitError(running: boolean) {
    return conflict(
      ErrorCode.LAST_UNIT,
      running
        ? 'This is the last unit. End the contract now instead.'
        : 'This is the last unit. Cancel the request instead.',
    );
  }

  // api-design 34 (REQ-EVT-33): what the release would do now. Nothing is stored or locked.
  async preview(id: string, deviceId: string, at: Date = new Date()): Promise<ReleasePreview> {
    return this.events.transaction(async (tx) => {
      const contract = await this.contracts.findById(id, tx);
      const { running, lastUnit } = await this.guard(contract, deviceId, tx, {});
      if (lastUnit) throw this.lastUnitError(running);
      const base = {
        phase: running ? ReleasePhase.RUNNING : ReleasePhase.BEFORE_HANDOVER,
        quantityBefore: contract.quantity,
        quantityAfter: contract.quantity - 1,
        lastUnit,
      };
      if (running) {
        const term = await this.contracts.openTerm(id, tx);
        const quote = releaseCreditQuote(
          { planType: planOf(contract), monthlyUnitPriceVnd: contract.monthlyUnitPriceVnd },
          term,
          at,
        );
        return {
          ...base,
          credit: {
            applies: quote !== null && quote.creditVnd > 0n,
            unusedDays: quote?.unusedDays ?? 0,
            termDays: quote?.termDays ?? 0,
            computedVnd: quote?.creditVnd ?? 0n,
          },
          firstInvoice: null,
        };
      }
      const firstInvoice = await this.charges.previewLowerFirstInvoice(
        this.firstInvoiceContract(contract),
        tx,
      );
      return { ...base, credit: null, firstInvoice };
    });
  }

  private firstInvoiceContract(contract: ContractRow) {
    return {
      id: contract.id,
      organizationId: contract.organizationId,
      planType: contract.planType,
      quantity: contract.quantity,
      monthlyUnitPriceVnd: contract.monthlyUnitPriceVnd,
      holdingFeeRatio: contract.holdingFeeRatio,
      dayPremium: contract.dayPremium,
      dayPlanDays: contract.dayPlanDays,
    };
  }

  // api-design 33 (REQ-EVT-31, REQ-EVT-32): the release itself, in one transaction under the contract lock.
  async release(
    id: string,
    deviceId: string,
    input: { reason: string; expectedVersion: number },
    actor: Caller,
    at: Date = new Date(),
  ): Promise<Released> {
    const reason = input.reason.trim();
    if (reason.length === 0 || reason.length > REASON_MAX) throw invalidReason();
    return this.events.transaction(async (tx) => {
      const contract = await this.contracts.lockById(id, tx);
      const { running, row, lastUnit } = await this.guard(contract, deviceId, tx, {
        reason,
        expectedVersion: input.expectedVersion,
      });
      if (lastUnit) throw this.lastUnitError(running);
      const move = { contractId: id, contractCode: contract.code, actorId: actor.id };

      let firstInvoiceLoweredByVnd: bigint | null = null;
      if (running) {
        await this.custody.closeCustody(
          contract.organizationId,
          [{ id: row.id, deviceId }],
          { reason: 'RELEASED', actorId: actor.id },
          at,
          tx,
        );
        await this.devices.markReturned([deviceId], at, tx, { ...move, reason: 'RELEASED' });
      } else {
        await this.contracts.releaseRow(row.id, at, tx);
        await this.devices.release([deviceId], at, tx, { ...move, reason: 'RELEASED' });
        const lowered = await this.charges.lowerFirstInvoice(
          this.firstInvoiceContract(contract),
          actor.id,
          tx,
        );
        firstInvoiceLoweredByVnd = lowered?.loweredByVnd ?? 0n;
      }

      const quantityAfter = contract.quantity - 1;
      if (!(await this.contracts.setQuantity(id, contract.version, quantityAfter, tx))) {
        throw conflict(
          ErrorCode.STALE_VERSION,
          'Someone else changed this. Reload to see the latest.',
        );
      }
      const release = await this.contracts.insertUnitRelease(
        {
          contractId: id,
          contractDeviceId: row.id,
          deviceId,
          phase: running ? ReleasePhase.RUNNING : ReleasePhase.BEFORE_HANDOVER,
          reason,
          releasedById: actor.id,
          releasedAt: at,
          quantityBefore: contract.quantity,
          quantityAfter,
        },
        tx,
      );

      let credit: Released['credit'] = null;
      if (running) {
        const term = await this.contracts.openTerm(id, tx);
        const requested = await this.credits.requestReleaseCredit(
          {
            contract: {
              id,
              organizationId: contract.organizationId,
              planType: planOf(contract),
              monthlyUnitPriceVnd: contract.monthlyUnitPriceVnd,
            },
            term,
            contractDeviceId: row.id,
            deviceId,
            unitReleaseId: release.id,
          },
          actor,
          at,
          tx,
        );
        if (requested.credit && requested.quote) {
          credit = {
            id: requested.credit.id,
            kind: requested.credit.kind,
            status: requested.credit.status,
            computedVnd: requested.credit.computedVnd,
            unusedDays: requested.quote.unusedDays,
            termDays: requested.quote.termDays,
          };
        }
      }

      this.events.emitAfterCommit(AUDIT_RECORD, {
        actorId: actor.id,
        actorRoles: actor.roles,
        organizationId: contract.organizationId,
        action: CONTRACT_UNIT_RELEASED,
        subjectType: 'RentalContract',
        subjectId: id,
        before: { quantity: contract.quantity, version: contract.version },
        after: {
          quantity: quantityAfter,
          deviceId,
          phase: release.phase,
          reason,
          releasedAt: at,
          serviceCreditId: credit?.id ?? null,
          firstInvoiceLoweredByVnd:
            firstInvoiceLoweredByVnd === null ? null : Number(firstInvoiceLoweredByVnd),
        },
      } satisfies AuditRecordEvent);
      if (running) {
        this.events.emitAfterCommit(DEVICE_CHECKED_IN, {
          deviceId,
          contractId: id,
          organizationId: contract.organizationId,
          at,
        } satisfies DeviceCheckedInEvent);
      }

      return {
        release: {
          id: release.id,
          contractId: id,
          deviceId,
          phase: release.phase,
          reason,
          releasedAt: at,
          quantityBefore: contract.quantity,
          quantityAfter,
          serviceCreditId: credit?.id ?? null,
        },
        contract: { id, quantity: quantityAfter, version: contract.version + 1 },
        credit,
        firstInvoiceLoweredByVnd,
      };
    });
  }
}
