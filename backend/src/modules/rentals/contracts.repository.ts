import { HttpStatus, Injectable } from '@nestjs/common';
import { ContractStatus, PlanType, Prisma } from '@prisma/client';
import { DomainException, ErrorCode } from '../../common/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FINISHED_STATES } from './contract-states';

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
  quantity: true,
  status: true,
  version: true,
} satisfies Prisma.RentalContractSelect;

export type ContractRow = Prisma.RentalContractGetPayload<{ select: typeof CONTRACT_SELECT }>;

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

export interface NewContractDevice {
  contractId: string;
  deviceId: string;
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
