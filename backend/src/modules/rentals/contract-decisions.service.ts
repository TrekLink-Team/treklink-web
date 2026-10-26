import { HttpStatus, Injectable } from '@nestjs/common';
import { ContractStatus, PlanType, Prisma } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { BalanceService, ChargesService, InvoicesService } from '../billing';
import { DevicesService, DeviceTag } from '../devices';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
import { ContractLifecycleService } from './contract-lifecycle.service';
import { firstTerm } from './contract-terms';
import { ContractRow, ContractsRepository } from './contracts.repository';

const HOUR_MS = 3_600_000;

export interface ApprovalInput {
  handoverAt: Date;
  expectedVersion: number;
}

export interface Approved {
  contract: ContractRow;
  devices: DeviceTag[];
  term: { seq: number; startsAt: Date; endsAt: Date };
  reservationExpiresAt: Date;
}

export interface Cancelled {
  contract: ContractRow;
  retainedVnd: bigint;
}

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

  // Reserves exactly the requested number of AVAILABLE units (409 INSUFFICIENT_DEVICES, nothing
  // reserved), creates term 1 anchored to the start date, issues its invoice and moves the contract
  // to APPROVED (REQ-EVT-02). The reservation expires `rentals.reservationExpiryHours` after the
  // handover appointment; the appointment itself is kept in the transition reason, as the schema has
  // no column for it.
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

      const variant = variants.find((item) => item.id === contract.hardwareVariantId);
      const variantCode = variant?.code ?? contract.hardwareVariantId;
      const devices = await this.devices.reserve(
        { id: contract.hardwareVariantId, code: variantCode },
        contract.quantity,
        at,
        tx,
      );
      await this.contracts.insertContractDevices(
        devices.map((device) => ({ contractId: id, deviceId: device.id })),
        tx,
      );

      const { startsAt, endsAt } = firstTerm(contract);
      const term = await this.contracts.insertTerm(
        { contractId: id, seq: 1, startsAt, endsAt },
        tx,
      );
      await this.issueFirstInvoice(contract, term, variantCode, tx, at);

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
        { decidedById: actor.id, decidedAt: at, reservationExpiresAt },
        tx,
      );
      return {
        contract: { ...approved, statusChangedAt: at },
        devices,
        term: { seq: term.seq, startsAt: term.startsAt, endsAt: term.endsAt },
        reservationExpiresAt,
      };
    });
  }

  // REQUESTED to REJECTED with the reason the Manager sees (MSG16).
  async reject(
    id: string,
    input: { reason: string; expectedVersion: number },
    actor: Caller,
    at: Date = new Date(),
  ): Promise<ContractRow> {
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
      return { ...rejected, statusChangedAt: at };
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
      const released = await this.contracts.releaseReservedRows(id, at, tx);
      await this.devices.release(released, at, tx);
      await this.charges.settleCancellation(
        { id, organizationId: contract.organizationId },
        actor.id,
        tx,
        at,
      );
      await this.contracts.recordCancellation(id, input.reason, at, tx);
      const { paidVnd } = await this.balances.balanceSummary(id, at, tx);
      return { contract: { ...cancelled, statusChangedAt: at }, retainedVnd: paidVnd };
    });
  }

  private issueFirstInvoice(
    contract: ContractRow,
    term: { id: string; seq: number; startsAt: Date; endsAt: Date },
    variantCode: string,
    tx: Prisma.TransactionClient,
    at: Date,
  ) {
    const billable = {
      id: contract.id,
      organizationId: contract.organizationId,
      quantity: contract.quantity,
      monthlyUnitPriceVnd: contract.monthlyUnitPriceVnd,
      variantCode,
    };
    if (contract.planType === PlanType.DAY) {
      return this.invoices.issueDayPlanInvoice(
        {
          ...billable,
          dayPremium: contract.dayPremium ?? new Prisma.Decimal(1),
          dayPlanDays: contract.dayPlanDays ?? 0,
          termId: term.id,
          startsAt: term.startsAt,
        },
        tx,
        at,
      );
    }
    return this.invoices.issueTermInvoice(
      { ...billable, holdingFeeRatio: contract.holdingFeeRatio },
      term,
      tx,
      at,
    );
  }
}
