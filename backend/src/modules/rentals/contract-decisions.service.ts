import { HttpStatus, Injectable } from '@nestjs/common';
import { ContractStatus, PlanType, Prisma } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { BalanceService, ChargesService, EarlyEndQuote, InvoicesService } from '../billing';
import { DevicesService, DeviceTag } from '../devices';
import { AUDIT_RECORD, AuditRecordEvent } from '../platform/audit/audit-record.event';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
import { ContractLifecycleService } from './contract-lifecycle.service';
import { ContractRow, ContractsRepository, DeviceRow, Holder } from './contracts.repository';
import { openFirstTerm } from './first-invoice';

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

export interface ApprovalInput {
  deviceIds?: string[];
  handoverAt: Date;
  expectedVersion: number;
}

export interface Approved {
  contract: ContractRow;
  devices: DeviceTag[];
  term: { seq: number; startsAt: Date; endsAt: Date };
  reservationExpiresAt: Date;
  handoverAppointmentAt: Date;
}

export const DEVICE_LABEL_CHANGED = 'device.labelChanged';

// `monitoring` turns it into the `device.label` stream entry (ws-live-contract), so only the name
// leaves rentals; the phone numbers stay on the contract.
export interface DeviceLabelChangedEvent {
  deviceId: string;
  contractId: string;
  organizationId: string;
  holder: { name: string } | null;
  at: Date;
}

export interface Notice {
  contract: ContractRow;
  term: { seq: number; startsAt: Date; endsAt: Date };
  dueAtEndVnd: bigint;
}

// End now (design §12, D-097): what the credit was and what is owed after it.
export interface EarlyEndOutcome {
  endedAt: Date;
  reason: string;
  creditVnd: bigint;
  usedDays: number;
  unusedDays: number;
  termDays: number;
  outstandingVnd: bigint;
  owedToOrganizationVnd: bigint;
}

export interface EndedNow {
  contract: ContractRow;
  term: { seq: number; startsAt: Date; endsAt: Date } | null;
  earlyEnd: EarlyEndOutcome;
}

// rentals api-design 31: what End now would do at `endsAt`; nothing is stored.
export interface EndPreview {
  contract: ContractRow;
  endsAt: Date;
  term: { seq: number; startsAt: Date; endsAt: Date } | null;
  termFeeVnd: bigint;
  termDays: number;
  usedDays: number;
  unusedDays: number;
  creditVnd: bigint;
  outstandingVnd: bigint;
  owedToOrganizationVnd: bigint;
}

export const CONTRACT_ENDED_EARLY = 'contract.endedEarly';

export interface ContractEndedEarlyEvent {
  contractId: string;
  organizationId: string;
  endedAt: Date;
  reason: string;
  creditVnd: bigint;
  actorId: string;
}

// The states End now leaves from (design §2, §12.1).
const ENDABLE: readonly ContractStatus[] = [ContractStatus.ACTIVE, ContractStatus.ENDING];

const REASON_MAX = 500;

const notEndable = (status: ContractStatus) =>
  new DomainException(
    HttpStatus.CONFLICT,
    ErrorCode.INVALID_STATE_TRANSITION,
    `This cannot be done while it is ${status}.`,
  );

// A contract with no open term (the rollover has not run yet past the term end) has nothing to credit.
const NO_CREDIT: EarlyEndQuote = {
  termFeeVnd: 0n,
  termDays: 0,
  usedDays: 0,
  unusedDays: 0,
  creditVnd: 0n,
};

export interface Cancelled {
  contract: ContractRow;
  retainedVnd: bigint;
}

export interface Rejected {
  contract: ContractRow;
  // A deposit paid on the request, refunded outside TrekLink (leader ruling 2026-11-01).
  paidVnd: bigint;
}

// The cancellation reason of an unpaid request hold past `holdExpiresAt` (REQ-EVT-17).
export const HOLD_EXPIRED = 'HOLD_EXPIRED';

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && b.every((id) => a.includes(id));

const notFound = () =>
  new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Contract not found.');

// MSG36: the caller saw an older version of the contract (REQ-UBI-01).
const assertVersion = (contract: ContractRow, expectedVersion: number) => {
  if (contract.version !== expectedVersion) {
    throw new DomainException(
      HttpStatus.CONFLICT,
      ErrorCode.STALE_VERSION,
      'Someone else changed this. Reload to see the latest.',
    );
  }
};

// Staff decisions on a request and its cancellation (rentals task 2.2, UC-16, UC-17, UC-18,
// FR-CON-03, FR-CON-04, FR-CON-11). Each runs in one transaction; the status change goes through
// ContractLifecycleService.apply, which locks the row and writes the transition.
@Injectable()
export class ContractDecisionsService {
  constructor(
    private readonly contracts: ContractsRepository,
    private readonly lifecycle: ContractLifecycleService,
    private readonly devices: DevicesService,
    private readonly invoices: InvoicesService,
    private readonly charges: ChargesService,
    private readonly balances: BalanceService,
    private readonly parameters: ParameterService,
    private readonly events: TransactionalEvents,
  ) {}

  // Keeps the units the request holds (D-092 rule 1, design §2.1), or, for a contract requested
  // before D-092 that holds none, reserves exactly the requested number of AVAILABLE units (409
  // INSUFFICIENT_DEVICES, nothing reserved), creates term 1 anchored to the start date and issues its
  // invoice; then moves the contract to APPROVED (REQ-EVT-02). `deviceIds` naming another set than
  // the held one is 400 (REQ-ERR-11). An appointment before the current minute is refused (REQ-ERR-09). The
  // reservation expires `rentals.reservationExpiryHours` after the
  // handover appointment, which is stored on the contract (`handoverAppointmentAt`, ruling on #87
  // point 1) and also named in the transition reason for the history.
  async approve(
    id: string,
    input: ApprovalInput,
    actor: Caller,
    at: Date = new Date(),
  ): Promise<Approved> {
    // The variant catalogue and the expiry parameter are read before the transaction opens, so the
    // transaction holds its connection only for its own statements (both reads are cached outside
    // any transaction).
    const variants = await this.devices.variants(false);
    const hours = await this.parameters.get('rentals.reservationExpiryHours');
    return this.events.transaction(async (tx) => {
      const contract = await this.contracts.lockById(id, tx);
      assertVersion(contract, input.expectedVersion);
      if (contract.status !== ContractStatus.REQUESTED) {
        throw new DomainException(
          HttpStatus.CONFLICT,
          ErrorCode.INVALID_STATE_TRANSITION,
          `This cannot be done while it is ${contract.status}.`,
        );
      }

      // REQ-ERR-09: the appointment field has minute precision, so the current minute still counts.
      if (input.handoverAt.getTime() < Math.floor(at.getTime() / MINUTE_MS) * MINUTE_MS) {
        throw new DomainException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_FAILED,
          'The handover appointment is in the past. Choose a time from now on.',
        );
      }

      const variant = variants.find((item) => item.id === contract.hardwareVariantId);
      const variantCode = variant?.code ?? contract.hardwareVariantId;
      if (
        input.deviceIds &&
        (input.deviceIds.length !== contract.quantity ||
          new Set(input.deviceIds).size !== contract.quantity)
      ) {
        throw new DomainException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_FAILED,
          `Choose exactly ${contract.quantity} distinct devices.`,
        );
      }
      const heldIds = (await this.contracts.liveRows(id, tx)).map((row) => row.deviceId);
      let devices: DeviceTag[];
      let term: { seq: number; startsAt: Date; endsAt: Date } | null = null;
      if (heldIds.length > 0) {
        // REQ-ERR-12: an unpaid hold that has already passed `holdExpiresAt` is not approved, even when
        // the expiry job (every ten minutes) has not cancelled it yet, so the outcome never depends on
        // the job's timing. A paid deposit keeps the hold until Staff decide (REQ-EVT-17).
        const expiresAt = await this.contracts.holdExpiresAt(id, tx);
        if (
          expiresAt !== null &&
          expiresAt.getTime() <= at.getTime() &&
          !(await this.balances.firstPaymentConfirmed(id, tx))
        ) {
          throw new DomainException(
            HttpStatus.CONFLICT,
            ErrorCode.INVALID_STATE_TRANSITION,
            'This request held its devices until the deposit was paid, and the hold has expired unpaid. It is cancelled shortly; the organization can request again.',
          );
        }
        const tags = await this.devices.assetTags(heldIds, tx);
        if (input.deviceIds && !sameSet(heldIds, input.deviceIds)) {
          const names = heldIds.map((deviceId) => tags.get(deviceId) ?? deviceId).join(', ');
          throw new DomainException(
            HttpStatus.BAD_REQUEST,
            ErrorCode.VALIDATION_FAILED,
            `This request already holds ${names}. Swap a unit at the counter instead.`,
          );
        }
        devices = heldIds.map((deviceId) => ({ id: deviceId, assetTag: tags.get(deviceId) ?? '' }));
        term = await this.contracts.openTerm(id, tx);
      } else {
        devices = await this.devices.reserve(
          { id: contract.hardwareVariantId, code: variantCode },
          contract.quantity,
          at,
          tx,
          { contractId: id, contractCode: contract.code, actorId: actor.id },
          input.deviceIds,
        );
        await this.contracts.insertContractDevices(
          devices.map((device) => ({ contractId: id, deviceId: device.id })),
          tx,
        );
      }
      // A contract requested before D-092 has no term yet; a held one has term 1 from its request.
      term ??= await openFirstTerm(this.contracts, this.invoices, contract, variantCode, tx, at);

      const reservationExpiresAt = new Date(input.handoverAt.getTime() + hours * HOUR_MS);
      const approved = await this.lifecycle.apply(
        id,
        ContractStatus.REQUESTED,
        ContractStatus.APPROVED,
        `Handover appointment ${input.handoverAt.toISOString()}`,
        actor,
        tx,
      );
      await this.contracts.recordDecision(
        id,
        {
          decidedById: actor.id,
          decidedAt: at,
          reservationExpiresAt,
          handoverAppointmentAt: input.handoverAt,
        },
        tx,
      );
      return {
        contract: { ...approved, statusChangedAt: at },
        devices,
        term: { seq: term.seq, startsAt: term.startsAt, endsAt: term.endsAt },
        reservationExpiresAt,
        handoverAppointmentAt: input.handoverAt,
      };
    });
  }

  // REQUESTED to REJECTED with the reason the Manager sees (MSG16). Since D-092 the request holds
  // devices and a first invoice: they are released and the unpaid lines voided in the same
  // transaction (REQ-EVT-03); a deposit already paid is answered as `paidVnd`, refunded outside
  // TrekLink (leader ruling 2026-11-01).
  async reject(
    id: string,
    input: { reason: string; expectedVersion: number },
    actor: Caller,
    at: Date = new Date(),
  ): Promise<Rejected> {
    return this.events.transaction(async (tx) => {
      const contract = await this.contracts.lockById(id, tx);
      assertVersion(contract, input.expectedVersion);
      const rejected = await this.lifecycle.apply(
        id,
        contract.status,
        ContractStatus.REJECTED,
        input.reason,
        actor,
        tx,
      );
      await this.contracts.recordDecision(
        id,
        { decidedById: actor.id, decidedAt: at, rejectionReason: input.reason },
        tx,
      );
      const paidVnd = await this.releaseAndVoid(contract, actor.id, tx, at);
      return { contract: { ...rejected, statusChangedAt: at }, paidVnd };
    });
  }

  // rentals.requestHoldExpiry (REQ-EVT-17, design §2.1): under the contract lock, a REQUESTED contract
  // past `holdExpiresAt` whose first payment is not paid in full has its devices released, its unpaid
  // first-invoice lines voided and moves to CANCELLED as SYSTEM with the reason HOLD_EXPIRED. Returns
  // false, changing nothing, when the contract moved on, the hold has not expired or is paid.
  async expireHold(id: string, at: Date = new Date()): Promise<boolean> {
    return this.events.transaction(async (tx) => {
      const contract = await this.contracts.lockById(id, tx);
      if (contract.status !== ContractStatus.REQUESTED) return false;
      const expiresAt = await this.contracts.holdExpiresAt(id, tx);
      if (!expiresAt || expiresAt.getTime() > at.getTime()) return false;
      if (await this.balances.firstPaymentConfirmed(id, tx)) return false;
      await this.lifecycle.apply(
        id,
        ContractStatus.REQUESTED,
        ContractStatus.CANCELLED,
        HOLD_EXPIRED,
        null,
        tx,
      );
      await this.releaseAndVoid(contract, null, tx, at);
      await this.contracts.recordCancellation(id, HOLD_EXPIRED, at, tx);
      return true;
    });
  }

  // REQUESTED or APPROVED to CANCELLED by the Org Manager (own) or Staff: the reserved units go back
  // to AVAILABLE and billing voids the unpaid first-invoice lines, keeping a paid holding fee, which
  // the answer reports as retained (FR-CON-04, MSG15). Another organization's contract is 404.
  async cancel(
    id: string,
    input: { reason: string; expectedVersion: number },
    actor: Caller,
    at: Date = new Date(),
  ): Promise<Cancelled> {
    return this.events.transaction(async (tx) => {
      const contract = await this.contracts.lockById(id, tx);
      if (actor.organizationId !== null && actor.organizationId !== contract.organizationId) {
        throw notFound();
      }
      assertVersion(contract, input.expectedVersion);
      const cancelled = await this.lifecycle.apply(
        id,
        contract.status,
        ContractStatus.CANCELLED,
        input.reason,
        actor,
        tx,
      );
      const paidVnd = await this.releaseAndVoid(contract, actor.id, tx, at);
      await this.contracts.recordCancellation(id, input.reason, at, tx);
      return { contract: { ...cancelled, statusChangedAt: at }, retainedVnd: paidVnd };
    });
  }

  // An Org Manager gives notice on an ACTIVE monthly contract (rentals task 3.1 part, UC-23,
  // REQ-EVT-07): it moves to ENDING and ends with the current term, when the term balance falls due
  // and the devices are returned (MSG18). A day plan ends on its own (409 DAY_PLAN_NO_NOTICE).
  async giveNotice(
    id: string,
    expectedVersion: number,
    actor: Caller,
    at: Date = new Date(),
  ): Promise<Notice> {
    return this.events.transaction(async (tx) => {
      const contract = await this.contracts.lockById(id, tx);
      if (actor.organizationId !== null && actor.organizationId !== contract.organizationId) {
        throw notFound();
      }
      assertVersion(contract, expectedVersion);
      if (contract.planType === PlanType.DAY) {
        throw new DomainException(
          HttpStatus.CONFLICT,
          ErrorCode.DAY_PLAN_NO_NOTICE,
          'A day plan ends on its own end date.',
        );
      }
      const term = await this.contracts.openTerm(id, tx);
      if (contract.status !== ContractStatus.ACTIVE || !term) {
        throw new DomainException(
          HttpStatus.CONFLICT,
          ErrorCode.INVALID_STATE_TRANSITION,
          `This cannot be done while it is ${contract.status}.`,
        );
      }
      const ending = await this.lifecycle.apply(
        id,
        ContractStatus.ACTIVE,
        ContractStatus.ENDING,
        'NOTICE',
        actor,
        tx,
      );
      await this.contracts.recordNotice(
        id,
        { noticeGivenAt: at, noticeGivenById: actor.id, endsAt: term.endsAt },
        tx,
      );
      const { dueLaterVnd } = await this.balances.balanceSummary(id, at, tx);
      return {
        contract: { ...ending, statusChangedAt: at, noticeGivenAt: at, endsAt: term.endsAt },
        term: { seq: term.seq, startsAt: term.startsAt, endsAt: term.endsAt },
        dueAtEndVnd: dueLaterVnd,
      };
    });
  }

  // End now (rentals task 10.2, REQ-EVT-27, REQ-ERR-17, design §12, D-097): Staff, or the Org Manager
  // of the contract's organization, end an ACTIVE or ENDING contract at once with a reason. In one
  // transaction the open term closes, billing credits its unused whole days on the closing invoice (none
  // for a day plan), endsAt and returnDueAt become the end time, and the contract moves to RETURN_DUE,
  // on to RETURNED when every device is already back or lost. The Manager's request ends it at once, like
  // Staff's action (design §12.2). The audit entry and `contract.endedEarly` go out after commit.
  async endNow(
    id: string,
    input: { reason: string; expectedVersion: number },
    actor: Caller,
    at: Date = new Date(),
  ): Promise<EndedNow> {
    const reason = input.reason.trim();
    if (reason.length === 0 || reason.length > REASON_MAX) {
      throw new DomainException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        `reason must be 1 to ${REASON_MAX} characters.`,
      );
    }
    return this.events.transaction(async (tx) => {
      const contract = await this.contracts.lockById(id, tx);
      if (actor.organizationId !== null && actor.organizationId !== contract.organizationId) {
        throw notFound();
      }
      assertVersion(contract, input.expectedVersion);
      if (!ENDABLE.includes(contract.status)) throw notEndable(contract.status);

      const term = await this.contracts.openTerm(id, tx);
      let quote = NO_CREDIT;
      if (term) {
        await this.contracts.closeTerm(term.id, tx);
        ({ quote } = await this.charges.creditEarlyEnd(
          {
            id,
            organizationId: contract.organizationId,
            planType: contract.planType,
            quantity: contract.quantity,
            monthlyUnitPriceVnd: contract.monthlyUnitPriceVnd,
          },
          term,
          at,
          reason,
          actor.id,
          tx,
        ));
      }
      await this.contracts.recordEarlyEnd(id, at, tx);
      let ended = await this.lifecycle.apply(
        id,
        contract.status,
        ContractStatus.RETURN_DUE,
        `Ended early: ${reason}`,
        actor,
        tx,
      );
      const { total, returned } = await this.contracts.returnCounts(id, tx);
      if (total > 0 && returned === total) {
        ended = await this.lifecycle.apply(
          id,
          ContractStatus.RETURN_DUE,
          ContractStatus.RETURNED,
          'ALL_DEVICES_BACK',
          actor,
          tx,
        );
      }
      const balance = await this.balances.balanceSummary(id, at, tx);
      const earlyEnd: EarlyEndOutcome = {
        endedAt: at,
        reason,
        creditVnd: quote.creditVnd,
        usedDays: quote.usedDays,
        unusedDays: quote.unusedDays,
        termDays: quote.termDays,
        outstandingVnd: balance.dueNowVnd + balance.dueLaterVnd,
        owedToOrganizationVnd: balance.owedToOrganizationVnd,
      };

      this.events.emitAfterCommit(AUDIT_RECORD, {
        actorId: actor.id,
        actorRoles: actor.roles,
        organizationId: contract.organizationId,
        action: CONTRACT_ENDED_EARLY,
        subjectType: 'RentalContract',
        subjectId: id,
        before: {
          status: contract.status,
          endsAt: contract.endsAt,
          returnDueAt: contract.returnDueAt,
        },
        after: {
          status: ended.status,
          reason,
          endedAt: at,
          creditVnd: Number(quote.creditVnd),
          unusedDays: quote.unusedDays,
          termDays: quote.termDays,
        },
      } satisfies AuditRecordEvent);
      this.events.emitAfterCommit(CONTRACT_ENDED_EARLY, {
        contractId: id,
        organizationId: contract.organizationId,
        endedAt: at,
        reason,
        creditVnd: quote.creditVnd,
        actorId: actor.id,
      } satisfies ContractEndedEarlyEvent);

      return {
        contract: { ...ended, statusChangedAt: at, endsAt: at, returnDueAt: at },
        term: term ? { seq: term.seq, startsAt: term.startsAt, endsAt: term.endsAt } : null,
        earlyEnd,
      };
    });
  }

  // The End now preview (REQ-EVT-28, api-design 31): billing's computation for `at`, and the balance
  // after the credit. Reads without a lock and stores nothing; the same 404 and 409 as End now.
  async endPreview(id: string, actor: Caller, at: Date = new Date()): Promise<EndPreview> {
    return this.events.transaction(async (tx) => {
      const contract = await this.contracts.findById(id, tx);
      if (actor.organizationId !== null && actor.organizationId !== contract.organizationId) {
        throw notFound();
      }
      if (!ENDABLE.includes(contract.status)) throw notEndable(contract.status);
      const term = await this.contracts.openTerm(id, tx);
      const quote = term
        ? this.charges.earlyEndCredit(
            {
              id,
              organizationId: contract.organizationId,
              planType: contract.planType,
              quantity: contract.quantity,
              monthlyUnitPriceVnd: contract.monthlyUnitPriceVnd,
            },
            term,
            at,
          )
        : NO_CREDIT;
      const after = await this.balances.afterCredit(id, quote.creditVnd, tx);
      return {
        contract,
        endsAt: at,
        term: term ? { seq: term.seq, startsAt: term.startsAt, endsAt: term.endsAt } : null,
        termFeeVnd: quote.termFeeVnd,
        termDays: quote.termDays,
        usedDays: quote.usedDays,
        unusedDays: quote.unusedDays,
        creditVnd: quote.creditVnd,
        outstandingVnd: after.outstandingVnd,
        owedToOrganizationVnd: after.owedToOrganizationVnd,
      };
    });
  }

  // A member of the renting organization labels a handed-over device with its holder, or clears
  // the label with a null name (rentals task 2.5, UC-25, REQ-EVT-15, BR-33). Only a device that is
  // out (handed over, not back, not lost) on a contract that is not CLOSED can be labelled.
  async setHolder(
    id: string,
    deviceId: string,
    holder: Holder | null,
    actor: Caller,
    at: Date = new Date(),
  ): Promise<DeviceRow> {
    return this.events.transaction(async (tx) => {
      const contract = await this.contracts.lockById(id, tx);
      if (actor.organizationId === null || actor.organizationId !== contract.organizationId) {
        throw notFound();
      }
      const row = await this.contracts.findDeviceRow(id, deviceId, tx);
      if (!row) {
        throw new DomainException(
          HttpStatus.CONFLICT,
          ErrorCode.DEVICE_NOT_ON_CONTRACT,
          `This device does not belong to contract ${contract.code}.`,
        );
      }
      const out = row.handedOverAt !== null && row.checkedInAt === null && row.lostAt === null;
      if (contract.status === ContractStatus.CLOSED || !out) {
        throw new DomainException(
          HttpStatus.CONFLICT,
          ErrorCode.INVALID_STATE_TRANSITION,
          `This cannot be done while it is ${out ? contract.status : 'not handed over'}.`,
        );
      }
      const labelled = await this.contracts.setHolder(row.id, holder, tx);
      this.events.emitAfterCommit(DEVICE_LABEL_CHANGED, {
        deviceId,
        contractId: id,
        organizationId: contract.organizationId,
        holder: holder ? { name: holder.name } : null,
        at,
      } satisfies DeviceLabelChangedEvent);
      return labelled;
    });
  }

  // Before handover: the rows not handed over are released with their units back to AVAILABLE, billing
  // voids the unpaid first-invoice lines (nothing when no invoice was issued), and the amount paid so
  // far is returned. Shared by cancel, reject and the hold expiry (FR-CON-04, D-092 rule 1).
  private async releaseAndVoid(
    contract: ContractRow,
    actorId: string | null,
    tx: Prisma.TransactionClient,
    at: Date,
  ): Promise<bigint> {
    const released = await this.contracts.releaseReservedRows(contract.id, at, tx);
    await this.devices.release(released, at, tx, {
      contractId: contract.id,
      contractCode: contract.code,
      actorId,
    });
    await this.charges.settleCancellation(
      { id: contract.id, organizationId: contract.organizationId },
      actorId,
      tx,
      at,
    );
    const { paidVnd } = await this.balances.balanceSummary(contract.id, at, tx);
    return paidVnd;
  }
}
