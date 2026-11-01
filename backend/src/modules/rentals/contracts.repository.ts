import { HttpStatus, Injectable } from '@nestjs/common';
import { ContractStatus, PlanType, Prisma } from '@prisma/client';
import { DomainException, ErrorCode } from '../../common/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FINISHED_STATES, RUNNING_STATES } from './contract-states';

type Client = Prisma.TransactionClient | PrismaService;

const HOUR_MS = 3_600_000;
// Contract codes count by the calendar year of the request in Vietnam (UTC+7); the start-date check
// of a request uses the same calendar.
export const CODE_ZONE_OFFSET_MS = 7 * HOUR_MS;
const CODE_MAX = 9999;

export const CONTRACT_SELECT = {
  id: true,
  code: true,
  organizationId: true,
  planType: true,
  dayPlanDays: true,
  hardwareVariantId: true,
  quantity: true,
  requestedStartDate: true,
  monthlyUnitPriceVnd: true,
  dayPremium: true,
  holdingFeeRatio: true,
  status: true,
  statusChangedAt: true,
  handedOverAt: true,
  endsAt: true,
  noticeGivenAt: true,
  returnDueAt: true,
  version: true,
} satisfies Prisma.RentalContractSelect;

export type ContractRow = Prisma.RentalContractGetPayload<{ select: typeof CONTRACT_SELECT }>;

export const TERM_SELECT = {
  id: true,
  seq: true,
  startsAt: true,
  endsAt: true,
  status: true,
} as const;

// A list row: the contract with its latest term, which is the current one (api-design 02).
export const LIST_SELECT = {
  ...CONTRACT_SELECT,
  reservationExpiresAt: true,
  handoverAppointmentAt: true,
  terms: { select: TERM_SELECT, orderBy: { seq: 'desc' }, take: 1 },
} satisfies Prisma.RentalContractSelect;

export type ContractListRow = Prisma.RentalContractGetPayload<{ select: typeof LIST_SELECT }>;

export const DEVICE_ROW_SELECT = {
  id: true,
  deviceId: true,
  handedOverAt: true,
  checkedInAt: true,
  lostAt: true,
  holderName: true,
  holderPhone: true,
  holderEmergencyContact: true,
} satisfies Prisma.ContractDeviceSelect;

// The detail: every term in order and the device rows still on the contract (api-design 03).
export const DETAIL_SELECT = {
  ...CONTRACT_SELECT,
  reservationExpiresAt: true,
  handoverAppointmentAt: true,
  terms: { select: TERM_SELECT, orderBy: { seq: 'asc' } },
  devices: {
    where: { releasedAt: null },
    select: DEVICE_ROW_SELECT,
    orderBy: { reservedAt: 'asc' },
  },
} satisfies Prisma.RentalContractSelect;

export type ContractDetailRow = Prisma.RentalContractGetPayload<{ select: typeof DETAIL_SELECT }>;

export const TRANSITION_SELECT = {
  fromStatus: true,
  toStatus: true,
  actorId: true,
  reason: true,
  createdAt: true,
} satisfies Prisma.ContractTransitionSelect;

export type TransitionRow = Prisma.ContractTransitionGetPayload<{
  select: typeof TRANSITION_SELECT;
}>;

export interface ContractFilter {
  organizationId?: string;
  status?: ContractStatus;
  planType?: PlanType;
}

export interface NewTerm {
  contractId: string;
  seq: number;
  startsAt: Date;
  endsAt: Date;
}

export interface Holder {
  name: string;
  phone: string | null;
  emergencyContact: string | null;
}

export type DeviceRow = Prisma.ContractDeviceGetPayload<{ select: typeof DEVICE_ROW_SELECT }>;

export interface Decision {
  decidedById: string;
  decidedAt: Date;
  reservationExpiresAt?: Date;
  handoverAppointmentAt?: Date;
  rejectionReason?: string;
}

export interface NewContract {
  organizationId: string;
  planType: PlanType;
  dayPlanDays: number | null;
  hardwareVariantId: string;
  quantity: number;
  requestedStartDate: Date;
  monthlyUnitPriceVnd: bigint;
  dayPremium: Prisma.Decimal | null;
  holdingFeeRatio: Prisma.Decimal;
  requestedById: string;
}

// Live contract rows: not released before handover or by a swap, and not replaced (rentals 4.3).
const LIVE = {
  releasedAt: null,
  replacedBy: { is: null },
} satisfies Prisma.ContractDeviceWhereInput;

// The reason that flags a reservation reminder on the transition table (rentals 3.2).
export const RESERVATION_REMINDED = 'RESERVATION_REMINDED';
export const RESERVATION_STAFF_REMINDED = 'RESERVATION_STAFF_REMINDED';

export interface NewContractDevice {
  contractId: string;
  deviceId: string;
}

export interface NewReplacementRow {
  contractId: string;
  deviceId: string;
  replacesId: string;
  handedOverAt: Date;
  replacementNotePath: string;
  replacementNoteSha256: string;
}

export interface TransitionInput {
  from: ContractStatus;
  to: ContractStatus;
  version: number;
  actorId: string | null;
  reason: string | null;
  at: Date;
}

// A custody interval: `handedOverAt` up to `checkedInAt` or `lostAt`, open while neither is set (D-040).
export const CUSTODY_SELECT = {
  id: true,
  handedOverAt: true,
  checkedInAt: true,
  lostAt: true,
  contract: { select: { id: true, organizationId: true, status: true } },
} satisfies Prisma.ContractDeviceSelect;

export type CustodyRow = Prisma.ContractDeviceGetPayload<{ select: typeof CUSTODY_SELECT }>;

export const codeYear = (at: Date): number =>
  new Date(at.getTime() + CODE_ZONE_OFFSET_MS).getUTCFullYear();

// The only class of `rentals` that touches Prisma (D-044 rule 4). Models: RentalContract,
// ContractDevice, ContractTerm, ContractTransition (rentals task 1.1, design Figure 4).
@Injectable()
export class ContractsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Inserts the contract REQUESTED with its code and its first transition row (REQ-UBI-01).
  async insertRequested(
    data: NewContract,
    at: Date,
    tx: Prisma.TransactionClient,
  ): Promise<ContractRow> {
    const code = await this.nextCode(at, tx);
    const contract = await tx.rentalContract.create({
      data: { ...data, code, status: ContractStatus.REQUESTED, statusChangedAt: at },
      select: CONTRACT_SELECT,
    });
    await tx.contractTransition.create({
      data: {
        contractId: contract.id,
        fromStatus: null,
        toStatus: ContractStatus.REQUESTED,
        actorId: data.requestedById,
        createdAt: at,
      },
    });
    return contract;
  }

  // Locks the contract row for the rest of the transaction; 404 when it does not exist.
  async lockById(id: string, tx: Prisma.TransactionClient): Promise<ContractRow> {
    await tx.$queryRaw`SELECT 1 FROM "rental_contracts" WHERE "id" = ${id} FOR UPDATE`;
    const contract = await tx.rentalContract.findUnique({ where: { id }, select: CONTRACT_SELECT });
    if (!contract) {
      throw new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Contract not found.');
    }
    return contract;
  }

  // The partial unique index refuses a second live row for one device (BR-03, REQ-UBI-02).
  async insertContractDevices(
    rows: readonly NewContractDevice[],
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.contractDevice.createMany({ data: [...rows] });
  }

  // Compare-and-set on status and version, plus one append-only transition row. Returns false when
  // another change won the row (REQ-UBI-01, FR-CON-13).
  async transition(
    id: string,
    change: TransitionInput,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    const { count } = await tx.rentalContract.updateMany({
      where: { id, status: change.from, version: change.version },
      data: { status: change.to, statusChangedAt: change.at, version: { increment: 1 } },
    });
    if (count !== 1) return false;
    await tx.contractTransition.create({
      data: {
        contractId: id,
        fromStatus: change.from,
        toStatus: change.to,
        actorId: change.actorId,
        reason: change.reason,
        createdAt: change.at,
      },
    });
    return true;
  }

  // The custody interval of the device that contains `at`, whatever state its contract is in now
  // (design §6, D-040).
  findCustody(
    deviceId: string,
    at: Date,
    client: Client = this.prisma,
  ): Promise<CustodyRow | null> {
    return client.contractDevice.findFirst({
      where: {
        deviceId,
        handedOverAt: { lte: at },
        AND: [
          { OR: [{ checkedInAt: null }, { checkedInAt: { gt: at } }] },
          { OR: [{ lostAt: null }, { lostAt: { gt: at } }] },
        ],
      },
      orderBy: { handedOverAt: 'desc' },
      select: CUSTODY_SELECT,
    });
  }

  // The holder labels of handed-over devices per (contract, device), latest handover first.
  findHolderLabels(
    pairs: readonly { contractId: string; deviceId: string }[],
    client: Client = this.prisma,
  ) {
    return client.contractDevice.findMany({
      where: {
        handedOverAt: { not: null },
        OR: pairs.map(({ contractId, deviceId }) => ({ contractId, deviceId })),
      },
      orderBy: { handedOverAt: 'desc' },
      select: { contractId: true, deviceId: true, holderName: true, holderPhone: true },
    });
  }

  // --- monitoring reads: `visibleDevices` (monitoring design §4) -----------------------------------
  // Devices in custody now: handed over and neither checked in nor lost, of one organization or of
  // every organization for a null scope.
  findInCustody(organizationId: string | null, client: Client = this.prisma) {
    return client.contractDevice.findMany({
      where: {
        handedOverAt: { not: null },
        checkedInAt: null,
        lostAt: null,
        ...(organizationId === null ? {} : { contract: { organizationId } }),
      },
      orderBy: { handedOverAt: 'asc' },
      select: {
        deviceId: true,
        contractId: true,
        holderName: true,
        contract: { select: { code: true, organizationId: true } },
      },
    });
  }

  // Every contract row of a device, for its lifecycle history (monitoring api-design 07).
  contractRowsOfDevice(deviceId: string, client: Client = this.prisma) {
    return client.contractDevice.findMany({
      where: { deviceId },
      orderBy: { reservedAt: 'asc' },
      select: {
        id: true,
        reservedAt: true,
        releasedAt: true,
        handedOverAt: true,
        checkedInAt: true,
        checkedInById: true,
        lostAt: true,
        contract: { select: { id: true, code: true, organizationId: true } },
      },
    });
  }

  // The handed-over rows of a device on one organization's contracts, oldest first (monitoring
  // api-design 03 reads a member's history inside these periods only).
  rentalPeriodsOfDevice(deviceId: string, organizationId: string, client: Client = this.prisma) {
    return client.contractDevice.findMany({
      where: { deviceId, handedOverAt: { not: null }, contract: { organizationId } },
      orderBy: { handedOverAt: 'asc' },
      select: { contractId: true, handedOverAt: true, checkedInAt: true, lostAt: true },
    });
  }

  // Every handed-over row whose custody interval overlaps [from, to), with its contract's variant
  // (monitoring api-design 08, utilization). An interval ends at its check-in or loss.
  intervalsOverlapping(from: Date, to: Date, client: Client = this.prisma) {
    return client.contractDevice.findMany({
      where: {
        handedOverAt: { lt: to },
        AND: [
          { OR: [{ checkedInAt: null }, { checkedInAt: { gt: from } }] },
          { OR: [{ lostAt: null }, { lostAt: { gt: from } }] },
        ],
      },
      select: {
        handedOverAt: true,
        checkedInAt: true,
        lostAt: true,
        contract: { select: { hardwareVariantId: true } },
      },
    });
  }

  // Contracts whose devices are out with the organization (api-design 03 `runningContracts`).
  countRunningContracts(organizationId: string, client: Client = this.prisma): Promise<number> {
    return client.rentalContract.count({
      where: { organizationId, status: { in: [...RUNNING_STATES] } },
    });
  }

  countUnfinishedContracts(organizationId: string, client: Client = this.prisma): Promise<number> {
    return client.rentalContract.count({
      where: { organizationId, status: { notIn: [...FINISHED_STATES] } },
    });
  }

  // Closes a custody interval at the loss confirmation time (REQ-EVT-12). Only an open interval
  // qualifies: a row already checked in or lost is refused with 409, so a wrong call cannot rewrite
  // the end of an interval that gateway-sync attribution relies on (D-040).
  async setLostAt(
    contractDeviceId: string,
    lostAt: Date,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const { count } = await tx.contractDevice.updateMany({
      where: { id: contractDeviceId, checkedInAt: null, lostAt: null },
      data: { lostAt },
    });
    if (count !== 1) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        ErrorCode.INVALID_STATE_TRANSITION,
        'The custody interval is already closed.',
      );
    }
  }

  // A page of contracts, newest first (api-design 02).
  page(
    filter: ContractFilter,
    skip: number,
    take: number,
    client: Client = this.prisma,
  ): Promise<[ContractListRow[], number]> {
    const where: Prisma.RentalContractWhereInput = {
      ...(filter.organizationId ? { organizationId: filter.organizationId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.planType ? { planType: filter.planType } : {}),
    };
    return Promise.all([
      client.rentalContract.findMany({
        where,
        orderBy: [{ statusChangedAt: 'desc' }, { code: 'desc' }],
        skip,
        take,
        select: LIST_SELECT,
      }),
      client.rentalContract.count({ where }),
    ]);
  }

  detail(id: string, client: Client = this.prisma): Promise<ContractDetailRow | null> {
    return client.rentalContract.findUnique({ where: { id }, select: DETAIL_SELECT });
  }

  transitionsOf(contractId: string, client: Client = this.prisma): Promise<TransitionRow[]> {
    return client.contractTransition.findMany({
      where: { contractId },
      orderBy: { createdAt: 'asc' },
      select: TRANSITION_SELECT,
    });
  }

  insertTerm(term: NewTerm, tx: Prisma.TransactionClient) {
    return tx.contractTerm.create({ data: term, select: TERM_SELECT });
  }

  // Compare-and-set on version alone, for a change that keeps the status and writes no transition row
  // (undoing a provisioning record, api-design 19). Returns false when another change won the row.
  async bumpVersion(id: string, version: number, tx: Prisma.TransactionClient): Promise<boolean> {
    const { count } = await tx.rentalContract.updateMany({
      where: { id, version },
      data: { version: { increment: 1 } },
    });
    return count === 1;
  }

  // The approval or rejection fields beside the status change, which `transition` writes.
  async recordDecision(
    id: string,
    decision: Decision,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.rentalContract.update({ where: { id }, data: decision });
  }

  async recordCancellation(
    id: string,
    reason: string,
    at: Date,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.rentalContract.update({
      where: { id },
      data: { cancelledAt: at, cancelReason: reason },
    });
  }

  // Releases the rows not yet handed over, so the devices may serve another contract (BR-03), and
  // returns their device ids.
  async releaseReservedRows(
    contractId: string,
    at: Date,
    tx: Prisma.TransactionClient,
  ): Promise<string[]> {
    const rows = await tx.contractDevice.findMany({
      where: { contractId, releasedAt: null, handedOverAt: null },
      select: { deviceId: true },
    });
    await tx.contractDevice.updateMany({
      where: { contractId, releasedAt: null, handedOverAt: null },
      data: { releasedAt: at },
    });
    return rows.map((row) => row.deviceId);
  }

  // One contract by its code (demo module, D-088).
  findByCode(code: string, client: Client = this.prisma): Promise<ContractRow | null> {
    return client.rentalContract.findUnique({ where: { code }, select: CONTRACT_SELECT });
  }

  // Moves an open term's dates (the demo time shift, D-088); the status is unchanged.
  async setTermDates(
    termId: string,
    dates: { startsAt: Date; endsAt: Date },
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.contractTerm.update({ where: { id: termId }, data: dates });
  }

  // The open term of a contract, the latest by seq; null before approval.
  openTerm(contractId: string, tx: Prisma.TransactionClient) {
    return tx.contractTerm.findFirst({
      where: { contractId, status: 'OPEN' },
      orderBy: { seq: 'desc' },
      select: TERM_SELECT,
    });
  }

  async recordNotice(
    id: string,
    notice: { noticeGivenAt: Date; noticeGivenById: string; endsAt: Date },
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.rentalContract.update({ where: { id }, data: notice });
  }

  // The row of the device that is still on the contract (not released), with its custody times.
  findDeviceRow(
    contractId: string,
    deviceId: string,
    tx: Prisma.TransactionClient,
  ): Promise<DeviceRow | null> {
    return tx.contractDevice.findFirst({
      where: { contractId, deviceId, releasedAt: null },
      orderBy: { reservedAt: 'desc' },
      select: DEVICE_ROW_SELECT,
    });
  }

  // Sets or clears the optional holder label of one row (FR-CON-14, BR-33).
  setHolder(
    rowId: string,
    holder: Holder | null,
    tx: Prisma.TransactionClient,
  ): Promise<DeviceRow> {
    return tx.contractDevice.update({
      where: { id: rowId },
      data: {
        holderName: holder?.name ?? null,
        holderPhone: holder?.phone ?? null,
        holderEmergencyContact: holder?.emergencyContact ?? null,
      },
      select: DEVICE_ROW_SELECT,
    });
  }

  // The rows still on the contract (not released), oldest reservation first.
  // A row is live while it is neither released nor replaced (rentals 4.3): a replaced row keeps its
  // custody history, and the replacement takes its place, so the live rows stay at the quantity.
  liveRows(contractId: string, client: Client = this.prisma) {
    return client.contractDevice.findMany({
      where: { contractId, ...LIVE },
      orderBy: { reservedAt: 'asc' },
      select: { id: true, deviceId: true, handedOverAt: true },
    });
  }

  // A failing reserved unit leaves the contract before handover (rentals 2.3, swap).
  async releaseRow(rowId: string, at: Date, tx: Prisma.TransactionClient): Promise<void> {
    await tx.contractDevice.update({ where: { id: rowId }, data: { releasedAt: at } });
  }

  async markRowsHandedOver(contractId: string, at: Date, tx: Prisma.TransactionClient) {
    await tx.contractDevice.updateMany({
      where: { contractId, releasedAt: null, handedOverAt: null },
      data: { handedOverAt: at },
    });
  }

  async recordHandover(
    id: string,
    handover: {
      handedOverAt: Date;
      handedOverById: string;
      identityChecked: string;
      handoverNotePath: string;
      handoverNoteSha256: string;
    },
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.rentalContract.update({ where: { id }, data: handover });
  }

  // The stored note of a contract, for the download and its integrity check (api-design 11).
  noteOf(id: string, client: Client = this.prisma) {
    return client.rentalContract.findUnique({
      where: { id },
      select: { organizationId: true, handoverNotePath: true, handoverNoteSha256: true },
    });
  }

  // Codes for the billing reads (the CONTRACT_DIRECTORY port).
  codes(ids: readonly string[], client: Client = this.prisma) {
    return client.rentalContract.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, code: true, organizationId: true },
    });
  }

  // The hardware variant of each contract (billing's CONTRACT_DIRECTORY, revenue per variant).
  variantsOf(ids: readonly string[], client: Client = this.prisma) {
    return client.rentalContract.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, hardwareVariantId: true },
    });
  }

  // The status alone, for the incidents authority report on a contract (incidents api-design 10).
  statusOf(id: string, client: Client = this.prisma) {
    return client.rentalContract.findUnique({ where: { id }, select: { status: true } });
  }

  termSeqs(ids: readonly string[], client: Client = this.prisma) {
    return client.contractTerm.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, seq: true },
    });
  }

  // MF-05 (tasks 3.1, 4.1, 4.2, 4.4). The rows handed over and still out: not checked in, not lost.
  rowsOut(contractId: string, tx: Prisma.TransactionClient) {
    return tx.contractDevice.findMany({
      where: {
        contractId,
        ...LIVE,
        handedOverAt: { not: null },
        checkedInAt: null,
        lostAt: null,
      },
      orderBy: { reservedAt: 'asc' },
      select: { id: true, deviceId: true },
    });
  }

  // Every device the contract held, replaced ones included, for the close checks: an incident or a
  // pending damage charge on a replaced unit still belongs to this contract.
  async custodyDevices(contractId: string, tx: Prisma.TransactionClient): Promise<string[]> {
    const rows = await tx.contractDevice.findMany({
      where: { contractId, releasedAt: null, handedOverAt: { not: null } },
      select: { deviceId: true },
    });
    return [...new Set(rows.map((row) => row.deviceId))];
  }

  // Units replaced while missing whose loss is not settled yet (no check-in, no lostAt): the contract
  // cannot close until the loss case settles and sets lostAt (rentals 4.3, REQ-EVT-12).
  unsettledReplacedLosses(contractId: string, tx: Prisma.TransactionClient): Promise<number> {
    return tx.contractDevice.count({
      where: {
        contractId,
        releasedAt: null,
        replacedBy: { isNot: null },
        checkedInAt: null,
        lostAt: null,
      },
    });
  }

  // The replacement's own custody interval (rentals 4.3, D-045), handed over at once.
  async insertReplacementRow(
    row: NewReplacementRow,
    tx: Prisma.TransactionClient,
  ): Promise<{ id: string }> {
    return tx.contractDevice.create({
      data: { ...row, reservedAt: row.handedOverAt },
      select: { id: true },
    });
  }

  // Handed-over rows of the contract, and how many of them are back or lost.
  async returnCounts(
    contractId: string,
    tx: Prisma.TransactionClient,
  ): Promise<{ total: number; returned: number }> {
    const where = { contractId, ...LIVE, handedOverAt: { not: null } };
    const [total, returned] = await Promise.all([
      tx.contractDevice.count({ where }),
      tx.contractDevice.count({
        where: { ...where, OR: [{ checkedInAt: { not: null } }, { lostAt: { not: null } }] },
      }),
    ]);
    return { total, returned };
  }

  async markCheckedIn(
    rowIds: readonly string[],
    at: Date,
    actorId: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.contractDevice.updateMany({
      where: { id: { in: [...rowIds] }, checkedInAt: null },
      data: { checkedInAt: at, checkedInById: actorId },
    });
  }

  // Holder labels are personal data and leave with the contract (BR-33).
  async eraseLabels(contractId: string, tx: Prisma.TransactionClient): Promise<void> {
    await tx.contractDevice.updateMany({
      where: { contractId },
      data: { holderName: null, holderPhone: null, holderEmergencyContact: null },
    });
  }

  // rentals 3.2: RETURN_DUE contracts whose return was due at or before `dueBy`.
  returnDueBefore(dueBy: Date, client: Client = this.prisma) {
    return client.rentalContract.findMany({
      where: { status: ContractStatus.RETURN_DUE, returnDueAt: { lte: dueBy } },
      select: { id: true },
      orderBy: { returnDueAt: 'asc' },
    });
  }

  // rentals 3.2: OVERDUE contracts that became overdue strictly before `overdueBy`.
  overdueBefore(overdueBy: Date, client: Client = this.prisma) {
    return client.rentalContract.findMany({
      where: { status: ContractStatus.OVERDUE, overdueAt: { lt: overdueBy } },
      select: { id: true },
      orderBy: { overdueAt: 'asc' },
    });
  }

  // rentals 3.2: the time a contract went OVERDUE or DEFAULTED.
  async stampOverdue(
    id: string,
    data: { overdueAt?: Date; defaultedAt?: Date },
    tx: Prisma.TransactionClient,
  ) {
    await tx.rentalContract.update({ where: { id }, data });
  }

  // rentals 3.2 (REQ-EVT-14): expired APPROVED contracts while either audience has no accepted
  // reminder. Each audience is flagged by its own transition reason (design §5).
  // Expired reservations that still lack the Manager reminder, or the Staff one when `withStaff`; a
  // deployment without Staff notifications never selects a contract for the Staff part alone.
  reservationsToRemind(at: Date, withStaff = true, client: Client = this.prisma) {
    const pending = [RESERVATION_REMINDED, ...(withStaff ? [RESERVATION_STAFF_REMINDED] : [])];
    return client.rentalContract.findMany({
      where: {
        status: ContractStatus.APPROVED,
        reservationExpiresAt: { lte: at },
        OR: pending.map((reason) => ({ transitions: { none: { reason } } })),
      },
      select: { id: true, code: true, organizationId: true, reservationExpiresAt: true },
      orderBy: { reservationExpiresAt: 'asc' },
    });
  }

  // Whether the contract was reminded already; read under the contract lock, so two job runs that
  // picked the same contract remind it once (review of #108).
  async hasReminder(
    contractId: string,
    tx: Prisma.TransactionClient,
    reason = RESERVATION_REMINDED,
  ): Promise<boolean> {
    const flags = await tx.contractTransition.count({
      where: { contractId, reason },
    });
    return flags > 0;
  }

  // The reminder flag: an APPROVED to APPROVED transition row by SYSTEM, which the append-only table
  // keeps, so a re-run never reminds twice.
  async flagReminded(
    contractId: string,
    at: Date,
    tx: Prisma.TransactionClient,
    reason = RESERVATION_REMINDED,
  ) {
    await tx.contractTransition.create({
      data: {
        contractId,
        fromStatus: ContractStatus.APPROVED,
        toStatus: ContractStatus.APPROVED,
        actorId: null,
        reason,
        createdAt: at,
      },
    });
  }

  async setReturnDueAt(id: string, returnDueAt: Date, tx: Prisma.TransactionClient) {
    await tx.rentalContract.update({ where: { id }, data: { returnDueAt } });
  }

  async closeTerm(termId: string, tx: Prisma.TransactionClient): Promise<boolean> {
    const { count } = await tx.contractTerm.updateMany({
      where: { id: termId, status: 'OPEN' },
      data: { status: 'CLOSED' },
    });
    return count === 1;
  }

  // The open terms that have ended, on contracts the rollover moves (ACTIVE or ENDING).
  dueTerms(at: Date, client: Client = this.prisma) {
    return client.contractTerm.findMany({
      where: {
        status: 'OPEN',
        endsAt: { lte: at },
        contract: { status: { in: [ContractStatus.ACTIVE, ContractStatus.ENDING] } },
      },
      orderBy: { endsAt: 'asc' },
      select: { ...TERM_SELECT, contractId: true },
    });
  }

  // RC-<year>-<4 digits>, serialized per year as incidents does (treklink-docs#103, 4).
  private async nextCode(at: Date, tx: Prisma.TransactionClient): Promise<string> {
    const year = codeYear(at);
    const prefix = `RC-${year}-`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`rentals:code:${year}`}))`;
    const latest = await tx.rentalContract.findFirst({
      where: { code: { startsWith: prefix } },
      orderBy: { code: 'desc' },
      select: { code: true },
    });
    const sequence = latest ? Number(latest.code.slice(prefix.length)) + 1 : 1;
    if (sequence > CODE_MAX) throw new RangeError(`Contract code range exhausted for ${year}.`);
    return `${prefix}${String(sequence).padStart(4, '0')}`;
  }
}
