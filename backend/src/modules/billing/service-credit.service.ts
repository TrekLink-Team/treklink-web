import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InspectionResult, Prisma, ServiceCreditCause, ServiceCreditStatus } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import {
  PagedQueryDto,
  PagedResult,
  pagingBoundsFrom,
  resolvePage,
  toPagedResult,
} from '../../common/dto/paging';
import { DomainException, ErrorCode } from '../../common/errors';
import { DevicesService } from '../devices';
import { AUDIT_RECORD, AuditRecordEvent } from '../platform/audit/audit-record.event';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import {
  dayPlanCreditVnd,
  earlyEndCreditOf,
  EarlyEndCredit,
  monthlyCreditVnd,
  termFeeVnd,
} from './money';
import { InvoicesRepository } from './invoices.repository';
import {
  CREDIT_BASIS,
  CreditBasis,
  CreditContract,
  CreditRelease,
  CreditUnit,
} from './ports/credit-basis.port';
import { ServiceCreditLedger } from './service-credit-ledger';
import {
  ServiceCreditFilter,
  ServiceCreditRow,
  ServiceCreditsRepository,
} from './service-credits.repository';

// After commit, for the organization's Managers (design §9.4); `rentals` sends the email, because
// `billing` may not import `organizations`, and only `rentals` knows the contract code.
export const SERVICE_CREDIT_NOTICE = 'billing.serviceCredit.notice';
export interface ServiceCreditNoticeEvent {
  creditId: string;
  contractId: string;
  organizationId: string;
  kind: 'REQUESTED' | 'APPROVED' | 'REJECTED';
  amountVnd: bigint;
}

export interface ServiceCreditRequest {
  contractDeviceId: string;
  cause: ServiceCreditCause;
  faultInspectionId: string;
  outageFrom?: Date;
  outageSourceIncidentId?: string;
  outageSourceFaultReportId?: string;
  outageSourceNote?: string;
}

export type ServiceCreditDecisionKind = 'APPROVE' | 'REDUCE' | 'REJECT';
export interface ServiceCreditDecision {
  decision: ServiceCreditDecisionKind;
  decidedVnd?: number;
  reason?: string;
  expectedVersion: number;
}

const DAY_MS = 86_400_000;

const invalid = (message: string) =>
  new DomainException(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_FAILED, message);
const notFound = () =>
  new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Service credit not found.');
const wrongState = (state: string) =>
  new DomainException(
    HttpStatus.CONFLICT,
    ErrorCode.INVALID_STATE_TRANSITION,
    `This cannot be done while it is ${state}.`,
  );

// Whole days, rounded up, so the shortest outage earns one day (design §9.2, leader ruling 2026-11-02).
export const outageDaysOf = (from: Date, to: Date): number =>
  Math.max(1, Math.ceil((to.getTime() - from.getTime()) / DAY_MS));

// The term the outage starts in: the one holding `at` (a day plan has one term).
const termHolding = (contract: CreditContract, at: Date) =>
  contract.terms.find(
    (term) => term.startsAt.getTime() <= at.getTime() && at.getTime() < term.endsAt.getTime(),
  ) ?? null;

// outageTo is computed, never entered (build ruling 2026-11-02): the first of the replacement's
// handover, the unit's check-in and the end of the term the outage starts in.
export const outageEndOf = (unit: CreditUnit, termEndsAt: Date): Date =>
  new Date(
    Math.min(
      termEndsAt.getTime(),
      unit.replacementHandedOverAt?.getTime() ?? Number.POSITIVE_INFINITY,
      unit.checkedInAt?.getTime() ?? Number.POSITIVE_INFINITY,
    ),
  );

// Whether `rentals` will still issue a term invoice for the contract: a monthly contract running
// without notice. Otherwise a decided credit goes to the closing invoice (REQ-EVT-14).
const nextTermComing = (contract: CreditContract): boolean =>
  contract.planType === 'MONTHLY' && contract.status === 'ACTIVE' && !contract.noticeGivenAt;

// The release credit of one unit (design §12.1, D-099 rule 1): the early-end computation of design
// §10.1 for a single unit. None for a day plan (D-097 rule 2) or without an open term. Stores nothing;
// the rentals preview and the release share it.
export const releaseCreditQuote = (
  contract: { planType: 'MONTHLY' | 'DAY'; monthlyUnitPriceVnd: bigint },
  term: { startsAt: Date; endsAt: Date } | null,
  at: Date,
): EarlyEndCredit | null => {
  if (contract.planType === 'DAY' || !term) return null;
  return earlyEndCreditOf(termFeeVnd(contract.monthlyUnitPriceVnd, 1), term, at);
};

// Service credits (billing task 8.1, design §9, D-092 rule 5): a unit of a contract that failed through
// no fault of the organization costs it nothing for the days it could not be used.
@Injectable()
export class ServiceCreditService {
  constructor(
    private readonly credits: ServiceCreditsRepository,
    private readonly invoices: InvoicesRepository,
    private readonly ledger: ServiceCreditLedger,
    private readonly devices: DevicesService,
    private readonly events: TransactionalEvents,
    private readonly config: ConfigService<ValidatedEnvironment, true>,
    @Optional() @Inject(CREDIT_BASIS) private readonly basis?: CreditBasis,
  ) {}

  // REQ-EVT-12, REQ-ERR-06, REQ-ERR-08: Staff request a credit after the unit is checked in or
  // replaced, with the FAILED inspection of that row and the source of the outage start.
  async request(
    contractId: string,
    input: ServiceCreditRequest,
    actor: Caller,
    at: Date = new Date(),
  ): Promise<ServiceCreditRow> {
    const { outageSourceFaultReportId } = input;
    const note = input.outageSourceNote?.trim();
    if (!input.outageSourceIncidentId && !outageSourceFaultReportId && !note) {
      throw invalid('Choose an incident, a fault report or a note as the outage source.');
    }
    if (!input.outageFrom && !outageSourceFaultReportId) {
      throw invalid('Enter the outage start or choose a fault report.');
    }
    if (input.outageFrom && input.outageFrom.getTime() > at.getTime()) {
      throw invalid('The outage start cannot be in the future.');
    }
    return this.events.transaction(async (tx) => {
      const found = this.basis
        ? await this.basis.basisOf(contractId, input.contractDeviceId, tx)
        : null;
      if (!found) {
        throw new DomainException(
          HttpStatus.CONFLICT,
          ErrorCode.DEVICE_NOT_ON_CONTRACT,
          'This device is not on the contract.',
        );
      }
      const { contract, unit } = found;
      let outageFrom = input.outageFrom;
      if (outageSourceFaultReportId) {
        const report = await this.basis?.faultReportSource(
          outageSourceFaultReportId,
          contractId,
          unit.contractDeviceId,
          tx,
        );
        if (!report)
          throw invalid('The outage source must be a fault report for this contract device.');
        outageFrom ??= report.reportedAt;
      }
      if (!outageFrom) throw invalid('Enter the outage start or choose a fault report.');
      if (outageFrom.getTime() > at.getTime()) {
        throw invalid('The outage start cannot be in the future.');
      }
      if (!unit.checkedInAt && !unit.replacementHandedOverAt) {
        throw new DomainException(
          HttpStatus.CONFLICT,
          ErrorCode.INVALID_STATE_TRANSITION,
          'A service credit is requested once the unit is checked in or replaced.',
        );
      }
      if (!unit.handedOverAt || outageFrom.getTime() < unit.handedOverAt.getTime()) {
        throw invalid('The outage start must be after the unit was handed over on this contract.');
      }
      const inspection = await this.devices.inspectionFor(input.faultInspectionId, tx);
      if (
        !inspection ||
        inspection.contractDeviceId !== unit.contractDeviceId ||
        inspection.result !== InspectionResult.FAILED
      ) {
        throw invalid(
          'The fault record must be a FAILED inspection of this unit on this contract.',
        );
      }
      const term = termHolding(contract, outageFrom);
      if (!term) throw invalid('The outage start is outside the contract terms.');
      const outageTo = outageEndOf(unit, term.endsAt);
      if (outageTo.getTime() <= outageFrom.getTime()) {
        throw invalid('The outage start must be before the unit was checked in or replaced.');
      }
      const outageDays = outageDaysOf(outageFrom, outageTo);
      const computedVnd =
        contract.planType === 'DAY'
          ? dayPlanCreditVnd(
              contract.monthlyUnitPriceVnd,
              contract.dayPremium ?? 0,
              outageDays,
              contract.dayPlanDays ?? outageDays,
            )
          : monthlyCreditVnd(
              contract.monthlyUnitPriceVnd,
              outageDays,
              outageDaysOf(term.startsAt, term.endsAt),
            );

      await this.credits.lockUnit(unit.contractDeviceId, tx);
      if (await this.credits.overlapping(unit.contractDeviceId, outageFrom, outageTo, tx)) {
        throw new DomainException(
          HttpStatus.CONFLICT,
          ErrorCode.DUPLICATE_CREDIT,
          'A service credit already covers part of this outage.',
        );
      }
      const credit = await this.credits.insert(
        {
          contractId,
          organizationId: contract.organizationId,
          contractDeviceId: unit.contractDeviceId,
          deviceId: unit.deviceId,
          cause: input.cause,
          faultInspectionId: inspection.id,
          outageFrom,
          outageSourceIncidentId: input.outageSourceIncidentId ?? null,
          outageSourceFaultReportId: outageSourceFaultReportId ?? null,
          outageSourceNote: note || null,
          outageTo,
          outageDays,
          computedVnd,
          requestedById: actor.id,
        },
        tx,
      );
      this.audit(actor, credit, 'serviceCredit.requested', null, {
        status: credit.status,
        computedVnd: computedVnd.toString(),
      });
      this.notice(credit, 'REQUESTED', computedVnd);
      return credit;
    });
  }

  // REQ-EVT-13, REQ-EVT-14, REQ-ERR-07: an Admin who did not request the credit decides it; an
  // approved or reduced amount lands on the closing invoice now when no further term invoice will be
  // issued, else on the next term invoice when `rentals` issues it.
  async decide(
    id: string,
    input: ServiceCreditDecision,
    actor: Caller,
    at: Date = new Date(),
  ): Promise<ServiceCreditRow> {
    return this.events.transaction(async (tx) => {
      const credit = await this.credits.lock(id, tx);
      if (!credit) throw notFound();
      if (credit.status !== ServiceCreditStatus.REQUESTED) throw wrongState(credit.status);
      if (credit.version !== input.expectedVersion) {
        throw new DomainException(
          HttpStatus.CONFLICT,
          ErrorCode.STALE_VERSION,
          'This was changed by someone else. Reload and try again.',
        );
      }
      if (credit.requestedById === actor.id) {
        throw new DomainException(
          HttpStatus.FORBIDDEN,
          ErrorCode.SEPARATION_OF_DUTY,
          'A different Admin must decide this credit.',
        );
      }
      const reason = input.reason?.trim() ?? '';
      if (input.decision !== 'APPROVE' && reason === '') {
        throw invalid('A reason is required to reduce or reject a credit.');
      }
      let decidedVnd: bigint | null = null;
      if (input.decision === 'APPROVE') decidedVnd = credit.computedVnd;
      if (input.decision === 'REDUCE') {
        decidedVnd = BigInt(input.decidedVnd ?? 0);
        if (decidedVnd <= 0n || decidedVnd >= credit.computedVnd) {
          throw invalid('decidedVnd must be above 0 and below the computed credit.');
        }
      }
      let decided = await this.credits.update(
        id,
        {
          status:
            input.decision === 'REJECT'
              ? ServiceCreditStatus.REJECTED
              : ServiceCreditStatus.APPROVED,
          decidedVnd,
          decisionReason: reason || null,
          decidedAt: at,
          decidedBy: { connect: { id: actor.id } },
        },
        tx,
      );
      if (decided.status === ServiceCreditStatus.APPROVED && this.basis) {
        const found = await this.basis.basisOf(decided.contractId, decided.contractDeviceId, tx);
        if (found && !nextTermComing(found.contract)) {
          const closing = await this.invoices.lockClosingInvoice(decided.contractId, tx);
          if (closing) await this.ledger.land(decided.contractId, closing, tx, at);
          decided = (await this.credits.find(id, tx)) ?? decided;
          // A contract already CLOSED issues no later invoice: what did not land is refunded
          // outside TrekLink (REQ-EVT-15, AC-08).
          if (
            found.contract.status === 'CLOSED' &&
            decided.status === ServiceCreditStatus.APPROVED
          ) {
            decided = await this.credits.update(id, { status: ServiceCreditStatus.REFUND_DUE }, tx);
          }
        }
      }
      this.audit(
        actor,
        decided,
        'serviceCredit.decided',
        { status: credit.status, computedVnd: credit.computedVnd.toString() },
        {
          status: decided.status,
          decidedVnd: decided.decidedVnd?.toString() ?? null,
          reason: decided.decisionReason,
        },
      );
      this.notice(
        decided,
        input.decision === 'REJECT' ? 'REJECTED' : 'APPROVED',
        decided.decidedVnd ?? 0n,
      );
      return decided;
    });
  }

  // REQ-EVT-15, AC-08: a refund paid outside TrekLink, recorded once by its unique reference.
  async recordRefund(
    id: string,
    reference: string,
    actor: Caller,
    at: Date = new Date(),
  ): Promise<ServiceCreditRow> {
    const trimmed = reference.trim();
    return this.events.transaction(async (tx) => {
      const credit = await this.credits.lock(id, tx);
      if (!credit) throw notFound();
      if (credit.status !== ServiceCreditStatus.REFUND_DUE) throw wrongState(credit.status);
      if (await this.credits.refundReferenceUsed(trimmed, tx)) {
        throw new DomainException(
          HttpStatus.CONFLICT,
          ErrorCode.DUPLICATE_REFERENCE,
          'This reference is already recorded.',
        );
      }
      const refunded = await this.credits.update(
        id,
        { status: ServiceCreditStatus.REFUNDED, refundReference: trimmed, refundedAt: at },
        tx,
      );
      this.audit(
        actor,
        refunded,
        'serviceCredit.refunded',
        { status: credit.status },
        {
          status: refunded.status,
          reference: trimmed,
        },
      );
      return refunded;
    });
  }

  // REQ-EVT-18 (D-099 rules 1 and 5): a released unit's credit, REQUESTED, authored by the Staff member
  // who released it, decided like any service credit. Called by `rentals` inside its release
  // transaction; nothing is recorded when the quote is zero or none applies. The Managers hear of it
  // when an Admin decides it.
  async requestReleaseCredit(
    input: {
      contract: {
        id: string;
        organizationId: string;
        planType: 'MONTHLY' | 'DAY';
        monthlyUnitPriceVnd: bigint;
      };
      term: { startsAt: Date; endsAt: Date } | null;
      contractDeviceId: string;
      deviceId: string;
      unitReleaseId: string;
    },
    actor: Caller,
    at: Date,
    tx: Prisma.TransactionClient,
  ): Promise<{ credit: ServiceCreditRow | null; quote: EarlyEndCredit | null }> {
    const quote = releaseCreditQuote(input.contract, input.term, at);
    if (!quote || quote.creditVnd === 0n) return { credit: null, quote };
    const credit = await this.credits.insertRelease(
      {
        contractId: input.contract.id,
        organizationId: input.contract.organizationId,
        contractDeviceId: input.contractDeviceId,
        deviceId: input.deviceId,
        unitReleaseId: input.unitReleaseId,
        computedVnd: quote.creditVnd,
        requestedById: actor.id,
      },
      tx,
    );
    this.audit(actor, credit, 'serviceCredit.requested', null, {
      status: credit.status,
      kind: credit.kind,
      computedVnd: quote.creditVnd.toString(),
      unusedDays: quote.unusedDays,
      termDays: quote.termDays,
    });
    return { credit, quote };
  }

  // The contract's REQUESTED credits, for the rentals close check and close (REQ-STA-02).
  requestedOf(contractId: string, tx?: Prisma.TransactionClient) {
    return this.credits.requestedOfContract(contractId, tx);
  }

  // At the close (REQ-EVT-15): every APPROVED credit with an amount still to land becomes REFUND_DUE.
  // Called by `rentals` inside its close transaction.
  async onContractClosed(contractId: string, tx: Prisma.TransactionClient): Promise<number> {
    const waiting = await this.credits.approvedWithRemainder(contractId, tx);
    for (const credit of waiting) {
      await this.credits.update(credit.id, { status: ServiceCreditStatus.REFUND_DUE }, tx);
    }
    return waiting.length;
  }

  // One page of credits, newest first, with each unit's asset tag. An organization member reads only
  // its own organization's (serviceCredit.read.own).
  async list(
    filter: ServiceCreditFilter,
    query: PagedQueryDto,
  ): Promise<
    PagedResult<ServiceCreditRow & { assetTag: string | null; release: CreditRelease | null }>
  > {
    const page = resolvePage(
      query,
      pagingBoundsFrom({
        DEFAULT_PAGE_SIZE: this.config.get('DEFAULT_PAGE_SIZE', { infer: true }),
        MAX_PAGE_SIZE: this.config.get('MAX_PAGE_SIZE', { infer: true }),
      }),
    );
    const [rows, total] = await this.credits.page(filter, page.skip, page.take);
    const tags = await this.devices.assetTags([...new Set(rows.map((row) => row.deviceId))]);
    const releaseIds = rows.flatMap((row) => (row.unitReleaseId ? [row.unitReleaseId] : []));
    const releases =
      releaseIds.length > 0 && this.basis
        ? await this.basis.releaseNotes(releaseIds)
        : new Map<string, CreditRelease>();
    return toPagedResult(
      rows.map((row) => ({
        ...row,
        assetTag: tags.get(row.deviceId) ?? null,
        release: row.unitReleaseId ? (releases.get(row.unitReleaseId) ?? null) : null,
      })),
      total,
      page,
    );
  }

  private audit(
    actor: Caller,
    credit: ServiceCreditRow,
    action: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown>,
  ): void {
    this.events.emitAfterCommit(AUDIT_RECORD, {
      actorId: actor.id,
      actorRoles: actor.roles,
      organizationId: credit.organizationId,
      action,
      subjectType: 'ServiceCredit',
      subjectId: credit.id,
      before,
      after,
    } satisfies AuditRecordEvent);
  }

  private notice(
    credit: ServiceCreditRow,
    kind: ServiceCreditNoticeEvent['kind'],
    amountVnd: bigint,
  ): void {
    this.events.emitAfterCommit(SERVICE_CREDIT_NOTICE, {
      creditId: credit.id,
      contractId: credit.contractId,
      organizationId: credit.organizationId,
      kind,
      amountVnd,
    } satisfies ServiceCreditNoticeEvent);
  }
}
