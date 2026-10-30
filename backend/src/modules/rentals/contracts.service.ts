import { HttpStatus, Injectable } from '@nestjs/common';
import { ContractStatus, PlanType, Prisma } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { dayPlanFeeVnd, holdingFeeVnd, PricingService, termFeeVnd } from '../billing';
import { OrganizationsService } from '../organizations';
import { AUDIT_RECORD, AuditRecordEvent } from '../platform/audit/audit-record.event';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
import { CODE_ZONE_OFFSET_MS, ContractRow, ContractsRepository } from './contracts.repository';

export interface Custody {
  contractDeviceId: string;
  contractId: string;
  organizationId: string;
  contractStatus: ContractStatus;
  // `at` lies within `marginSeconds` of the handover or of the interval's end (D-040).
  nearBoundary: boolean;
}

// One custody row of a device on a contract (monitoring api-design 07).
export interface DeviceContractRow {
  contractDeviceId: string;
  contractId: string;
  contractCode: string;
  organizationId: string;
  reservedAt: Date;
  releasedAt: Date | null;
  handedOverAt: Date | null;
  checkedInAt: Date | null;
  checkedInById: string | null;
  lostAt: Date | null;
}

export interface HolderLabel {
  name: string;
  phone: string | null;
}

// A device the scope may see on the live views now: in custody on one of its contracts.
export interface VisibleDevice {
  deviceId: string;
  contractId: string;
  contractCode: string;
  organizationId: string;
  // The holder label set at handover; null before one is set or after it was erased (FR-CON-14).
  holder: { name: string } | null;
}

const near = (at: Date, edge: Date | null, marginMs: number) =>
  edge !== null && Math.abs(at.getTime() - edge.getTime()) <= marginMs;

export interface ContractRequest {
  planType: PlanType;
  dayPlanDays?: number;
  hardwareVariantId: string;
  quantity: number;
  // The handover day, a calendar date at UTC midnight as Prisma reads a @db.Date column.
  requestedStartDate: Date;
}

// The amounts of rentals api-design 01's `quote`: the term fee and holding fee of a monthly plan, or
// the whole day-plan amount, paid up front.
export type RequestQuote =
  { firstPaymentVnd: bigint; termFeeVnd: bigint } | { firstPaymentVnd: bigint; totalVnd: bigint };

export interface RequestedContract {
  contract: ContractRow;
  quote: RequestQuote;
}

const badRequest = (code: ErrorCode, message: string) =>
  new DomainException(HttpStatus.BAD_REQUEST, code, message);

// The calendar day of `at` in UTC+7, as yyyy-mm-dd.
const localDay = (at: Date): string =>
  new Date(at.getTime() + CODE_ZONE_OFFSET_MS).toISOString().slice(0, 10);

const lengthsOf = (value: Prisma.JsonValue): number[] =>
  Array.isArray(value) ? value.filter((n): n is number => typeof n === 'number') : [];

// Contract reads and the behaviours behind the ports `rentals` provides (rentals task 1.3, design §6).
// Until `organizations` and `devices` declare ORGANIZATION_EXIT_CHECKS, CUSTODY_RESOLVER and
// LOSS_CASE_LISTENERS, these methods are not yet registered under them (treklink-docs#103, 1).
@Injectable()
export class ContractsService {
  constructor(
    private readonly contracts: ContractsRepository,
    private readonly organizations: OrganizationsService,
    private readonly pricing: PricingService,
    private readonly parameters: ParameterService,
    private readonly events: TransactionalEvents,
  ) {}

  // An Org Manager requests a plan (rentals task 2.1, UC-15, REQ-EVT-01, api-design 01). In one
  // transaction: the organization must be ACTIVE (409 ORGANIZATION_NOT_ACTIVE), the quantity at
  // least `rentals.minOrderQuantity` (400 BELOW_MOQ, MSG13), a DAY plan one of
  // `rentals.dayPlanLengths` (400 DAY_PLAN_LENGTH) and the start date not before today in UTC+7;
  // then the price, day premium and holding-fee ratio are snapshotted from billing (FR-CFG-02) and
  // the contract is inserted REQUESTED. A variant without a price in effect is 404 from the snapshot.
  async request(
    input: ContractRequest,
    caller: Caller,
    at: Date = new Date(),
  ): Promise<RequestedContract> {
    const organizationId = caller.organizationId;
    if (organizationId === null) {
      throw new DomainException(
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
        'You do not have access to this.',
      );
    }

    return this.events.transaction(async (tx) => {
      await this.organizations.assertActive(organizationId, tx);

      const minOrderQuantity = await this.parameters.get('rentals.minOrderQuantity', tx);
      if (input.quantity < minOrderQuantity) {
        throw badRequest(ErrorCode.BELOW_MOQ, `The minimum order is ${minOrderQuantity} devices.`);
      }
      const isDayPlan = input.planType === PlanType.DAY;
      if (isDayPlan) {
        const lengths = lengthsOf(await this.parameters.get('rentals.dayPlanLengths', tx));
        if (input.dayPlanDays === undefined || !lengths.includes(input.dayPlanDays)) {
          throw badRequest(
            ErrorCode.DAY_PLAN_LENGTH,
            `Choose a plan of ${lengths.slice(0, -1).join(', ')} or ${lengths.at(-1)} days.`,
          );
        }
      }
      if (input.requestedStartDate.toISOString().slice(0, 10) < localDay(at)) {
        throw badRequest(
          ErrorCode.VALIDATION_FAILED,
          'requestedStartDate must not be in the past.',
        );
      }

      const snapshot = await this.pricing.snapshot(input.hardwareVariantId, tx, at);
      const contract = await this.contracts.insertRequested(
        {
          organizationId,
          planType: input.planType,
          dayPlanDays: isDayPlan ? (input.dayPlanDays as number) : null,
          hardwareVariantId: input.hardwareVariantId,
          quantity: input.quantity,
          requestedStartDate: input.requestedStartDate,
          monthlyUnitPriceVnd: snapshot.monthlyUnitPriceVnd,
          dayPremium: isDayPlan ? snapshot.dayPremium : null,
          holdingFeeRatio: snapshot.holdingFeeRatio,
          requestedById: caller.id,
        },
        at,
        tx,
      );
      this.events.emitAfterCommit(AUDIT_RECORD, {
        actorId: caller.id,
        actorRoles: caller.roles,
        organizationId,
        action: 'contract.request',
        subjectType: 'RentalContract',
        subjectId: contract.id,
        after: {
          code: contract.code,
          planType: input.planType,
          quantity: input.quantity,
          monthlyUnitPriceVnd: snapshot.monthlyUnitPriceVnd.toString(),
        },
      } satisfies AuditRecordEvent);

      const price = snapshot.monthlyUnitPriceVnd;
      const quote: RequestQuote = isDayPlan
        ? (() => {
            const totalVnd = dayPlanFeeVnd(
              price,
              snapshot.dayPremium,
              input.dayPlanDays as number,
              input.quantity,
            );
            return { firstPaymentVnd: totalVnd, totalVnd };
          })()
        : {
            firstPaymentVnd: holdingFeeVnd(price, input.quantity, snapshot.holdingFeeRatio),
            termFeeVnd: termFeeVnd(price, input.quantity),
          };
      return { contract, quote };
    });
  }

  // The custody interval containing `at`, whatever state the contract is in now; null when none does.
  async custodyAt(deviceId: string, at: Date, marginSeconds: number): Promise<Custody | null> {
    const row = await this.contracts.findCustody(deviceId, at);
    if (!row?.handedOverAt) return null;

    const end = row.checkedInAt ?? row.lostAt;
    const marginMs = marginSeconds * 1000;
    return {
      contractDeviceId: row.id,
      contractId: row.contract.id,
      organizationId: row.contract.organizationId,
      contractStatus: row.contract.status,
      nearBoundary: near(at, row.handedOverAt, marginMs) || near(at, end, marginMs),
    };
  }

  // The holder label of a device on a contract, keyed `contractId:deviceId`, for the incident alert,
  // list and detail (incidents 2.1, 5.1). A pair without a handed-over row, or whose label was erased
  // at close (FR-CON-14), is absent. A replaced device keeps its own row's label.
  async holderLabels(
    pairs: readonly { contractId: string; deviceId: string }[],
  ): Promise<Map<string, HolderLabel>> {
    if (pairs.length === 0) return new Map();
    const labels = new Map<string, HolderLabel>();
    for (const row of await this.contracts.findHolderLabels(pairs)) {
      const key = `${row.contractId}:${row.deviceId}`;
      if (labels.has(key) || row.holderName === null) continue;
      labels.set(key, { name: row.holderName, phone: row.holderPhone });
    }
    return labels;
  }

  // --- monitoring reads (monitoring design §4), `visibleDevices(caller)` ---------------------------
  // The devices in custody now of the caller's organization, or of every organization for a caller
  // with none (TrekLink Staff and Admin). A Caller fits; the organization API passes its key's
  // organization. A device appears once, on the contract holding it now (RETURN_DUE, OVERDUE and
  // DEFAULTED keep their devices visible, REQ-STA-02).
  async visibleDevices(caller: { organizationId: string | null }): Promise<VisibleDevice[]> {
    const rows = await this.contracts.findInCustody(caller.organizationId);
    return rows.map((row) => ({
      deviceId: row.deviceId,
      contractId: row.contractId,
      contractCode: row.contract.code,
      organizationId: row.contract.organizationId,
      holder: row.holderName === null ? null : { name: row.holderName },
    }));
  }
  // --- end monitoring reads ---------------------------------------------------------------------------

  // The custody rows of a device on every contract, oldest first, for its lifecycle history
  // (monitoring api-design 07, design §3 of monitoring). A row released before handover still shows
  // that the unit was reserved.
  async contractsOfDevice(deviceId: string): Promise<DeviceContractRow[]> {
    const rows = await this.contracts.contractRowsOfDevice(deviceId);
    return rows.map((row) => ({
      contractDeviceId: row.id,
      contractId: row.contract.id,
      contractCode: row.contract.code,
      organizationId: row.contract.organizationId,
      reservedAt: row.reservedAt,
      releasedAt: row.releasedAt,
      handedOverAt: row.handedOverAt,
      checkedInAt: row.checkedInAt,
      checkedInById: row.checkedInById,
      lostAt: row.lostAt,
    }));
  }

  // ORGANIZATION_EXIT_CHECKS.canClose: an organization with a contract that is not REJECTED,
  // CANCELLED or CLOSED may not close.
  async canClose(organizationId: string): Promise<boolean> {
    return (await this.contracts.countUnfinishedContracts(organizationId)) === 0;
  }

  // LOSS_CASE_LISTENERS.onSettled: the row's interval ends at the loss confirmation, inside the
  // caller's transaction (REQ-EVT-12, FR-DEV-13). `onConfirmed` does nothing for rentals.
  onLossSettled(
    contractDeviceId: string,
    confirmedAt: Date,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    return this.contracts.setLostAt(contractDeviceId, confirmedAt, tx);
  }
}
