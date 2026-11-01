import { HttpStatus, Injectable } from '@nestjs/common';
import { ContractStatus, PlanType, Prisma } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { dayPlanFeeVnd, holdingFeeVnd, PricingService, termFeeVnd } from '../billing';
import { DevicesService } from '../devices';
import { OrganizationsService } from '../organizations';
import { AUDIT_RECORD, AuditRecordEvent } from '../platform/audit/audit-record.event';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
import {
  CODE_ZONE_OFFSET_MS,
  ContractRow,
  ContractsRepository,
  CustodyRow,
} from './contracts.repository';
import { CONTRACT_REQUESTED, ContractRequestedEvent } from './contract-notification.events';

export interface Custody {
  contractDeviceId: string;
  contractId: string;
  organizationId: string;
  contractStatus: ContractStatus;
  // The interval's ends: the handover, and the check-in or loss, null while it is open (D-040). The
  // attribution margin around them is gateway-sync's rule (`attribution.ts`).
  handedOverAt: Date;
  endedAt: Date | null;
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

// One custody period of a device on an organization's contract: handover to check-in or loss, open
// (`to` null) while the device is still out (monitoring api-design 03).
export interface RentalPeriod {
  contractId: string;
  from: Date;
  to: Date | null;
}

// Rented unit-days of one hardware variant over a range (monitoring api-design 08, utilization):
// the overlap of every custody interval with the range, in days rounded to two decimals.
export interface VariantUtilization {
  hardwareVariantId: string;
  rentedUnitDays: number;
}

const DAY_MS = 86_400_000;

// A device the scope may see on the live views now: in custody on one of its contracts.
export interface VisibleDevice {
  deviceId: string;
  contractId: string;
  contractCode: string;
  organizationId: string;
  // The holder label set at handover; null before one is set or after it was erased (FR-CON-14).
  holder: { name: string } | null;
}

// The custody of the interval `findCustody` returned for `at`: none for no row or a row never
// handed over. Shared by `custodyAt` and the CUSTODY_RESOLVER provider, which has no
// ContractsService in the ports module.
export const custodyOf = (row: CustodyRow | null): Custody | null => {
  if (!row?.handedOverAt) return null;
  return {
    contractDeviceId: row.id,
    contractId: row.contract.id,
    organizationId: row.contract.organizationId,
    contractStatus: row.contract.status,
    handedOverAt: row.handedOverAt,
    endedAt: row.checkedInAt ?? row.lostAt,
  };
};

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
// They are registered by RentalsOrganizationExitCheck (ORGANIZATION_EXIT_CHECKS),
// RentalsCustodyResolver in RentalsPortsModule (CUSTODY_RESOLVER) and RentalsLossCaseListener
// (LOSS_CASE_LISTENERS).
@Injectable()
export class ContractsService {
  constructor(
    private readonly contracts: ContractsRepository,
    private readonly organizations: OrganizationsService,
    private readonly pricing: PricingService,
    private readonly parameters: ParameterService,
    private readonly events: TransactionalEvents,
    private readonly devices: DevicesService,
  ) {}

  // An Org Manager requests a plan (rentals task 2.1, UC-15, REQ-EVT-01, api-design 01). In one
  // transaction: the organization must be ACTIVE (409 ORGANIZATION_NOT_ACTIVE), the quantity at
  // least `rentals.minOrderQuantity` (400 BELOW_MOQ, MSG13), a DAY plan one of
  // `rentals.dayPlanLengths` (400 DAY_PLAN_LENGTH) and the start date not before today in UTC+7;
  // then the price, day premium and holding-fee ratio are snapshotted from billing (FR-CFG-02) and
  // the contract is inserted REQUESTED. An inactive or unknown variant is 404, as is a variant
  // without a price in effect. The variant read joins the request transaction. The organization row
  // is held FOR SHARE to the end of it, so a closing (organizations api-design 10) that locks the row
  // FOR UPDATE either counts this contract or commits first and refuses it as CLOSED.
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
      await this.organizations.lockActive(organizationId, tx);

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

      const variants = await this.devices.variants(true, tx);
      if (!variants.some((variant) => variant.id === input.hardwareVariantId && variant.isActive)) {
        throw new DomainException(
          HttpStatus.NOT_FOUND,
          ErrorCode.NOT_FOUND,
          'Active hardware variant not found.',
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
      this.events.emitAfterCommit(CONTRACT_REQUESTED, {
        contractId: contract.id,
        organizationId,
      } satisfies ContractRequestedEvent);

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
  async custodyAt(deviceId: string, at: Date): Promise<Custody | null> {
    return custodyOf(await this.contracts.findCustody(deviceId, at));
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

  // A contract's status, or null when there is none, for the incidents authority report on a
  // DEFAULTED contract (incidents api-design 10). A plain read, no row lock.
  async statusOf(contractId: string): Promise<ContractStatus | null> {
    return (await this.contracts.statusOf(contractId))?.status ?? null;
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

  // The periods a device was in the organization's custody, oldest first (rentals 4.5, design §6), so
  // monitoring serves a member only the telemetry of its own rental periods (REQ-EVT-06).
  async rentalPeriods(deviceId: string, organizationId: string): Promise<RentalPeriod[]> {
    const rows = await this.contracts.rentalPeriodsOfDevice(deviceId, organizationId);
    return rows.flatMap((row) =>
      row.handedOverAt
        ? [
            {
              contractId: row.contractId,
              from: row.handedOverAt,
              to: row.checkedInAt ?? row.lostAt,
            },
          ]
        : [],
    );
  }

  // Rented unit-days per hardware variant over [from, to) (rentals 4.5, design §6), for the
  // utilization report: each custody interval counts its overlap with the range, and an interval
  // still open counts up to `at` at most, so a range reaching into the future counts no future day.
  // Units in service come from `devices`; the report divides the two.
  async utilization(
    range: { from: Date; to: Date },
    at: Date = new Date(),
  ): Promise<VariantUtilization[]> {
    const end = Math.min(range.to.getTime(), at.getTime());
    const msByVariant = new Map<string, number>();
    for (const row of await this.contracts.intervalsOverlapping(range.from, range.to)) {
      if (!row.handedOverAt) continue;
      const start = Math.max(row.handedOverAt.getTime(), range.from.getTime());
      const stop = Math.min((row.checkedInAt ?? row.lostAt)?.getTime() ?? end, end);
      if (stop <= start) continue;
      const variant = row.contract.hardwareVariantId;
      msByVariant.set(variant, (msByVariant.get(variant) ?? 0) + stop - start);
    }
    return [...msByVariant.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([hardwareVariantId, ms]) => ({
        hardwareVariantId,
        rentedUnitDays: Math.round((ms / DAY_MS) * 100) / 100,
      }));
  }

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

  // ORGANIZATION_COUNTS `runningContracts` (RentalsOrganizationCount).
  countRunning(organizationId: string): Promise<number> {
    return this.contracts.countRunningContracts(organizationId);
  }

  // ORGANIZATION_EXIT_CHECKS.canClose: an organization with a contract that is not REJECTED,
  // CANCELLED or CLOSED may not close. `tx` is the closing transaction (RentalsOrganizationExitCheck).
  async canClose(organizationId: string, tx?: Prisma.TransactionClient): Promise<boolean> {
    return (await this.contracts.countUnfinishedContracts(organizationId, tx)) === 0;
  }

  // LOSS_CASE_LISTENERS.onSettled (RentalsLossCaseListener): the row's interval ends at the loss
  // confirmation, inside the caller's transaction (REQ-EVT-12, FR-DEV-13). `onConfirmed` does
  // nothing for rentals.
  onLossSettled(
    contractDeviceId: string,
    confirmedAt: Date,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    return this.contracts.setLostAt(contractDeviceId, confirmedAt, tx);
  }
}
