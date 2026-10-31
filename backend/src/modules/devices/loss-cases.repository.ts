import { Injectable } from '@nestjs/common';
import { LossCaseState, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

type Client = Prisma.TransactionClient | PrismaService;

export const LOSS_CASE_SELECT = {
  id: true,
  code: true,
  deviceId: true,
  device: { select: { id: true, assetTag: true } },
  state: true,
  stateFromDevice: true,
  reportedById: true,
  reportedAt: true,
  description: true,
  lastSeenAt: true,
  lastLatitude: true,
  lastLongitude: true,
  custody: true,
  contractDeviceId: true,
  contractId: true,
  organizationId: true,
  keyExposed: true,
  suspectedTheft: true,
  policeReference: true,
  complianceCaseId: true,
  triagedById: true,
  triagedAt: true,
  searchEndsAt: true,
  recoveredAt: true,
  confirmedAt: true,
  decision: true,
  chargeVnd: true,
  decisionReason: true,
  decidedById: true,
  settledAt: true,
  version: true,
} satisfies Prisma.LossCaseSelect;

export type LossCaseRow = Prisma.LossCaseGetPayload<{ select: typeof LOSS_CASE_SELECT }>;

export interface LossCaseFilter {
  organizationId?: string;
  state?: LossCaseState;
}

// The loss cases of devices (task 2.7, design §2.1, D-045). The only class that reads or writes
// `loss_cases`; the device moves of a loss case go through DevicesRepository in the same transaction.
@Injectable()
export class LossCasesRepository {
  constructor(private readonly prisma: PrismaService) {}

  find(id: string, client: Client = this.prisma): Promise<LossCaseRow | null> {
    return client.lossCase.findUnique({ where: { id }, select: LOSS_CASE_SELECT });
  }

  // LOSS-0001 upwards, serialized by an advisory lock held to the end of the transaction, the same
  // scheme as the compliance case codes.
  async nextCode(tx: Prisma.TransactionClient): Promise<string> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('loss_cases.code'))`;
    const rows = await tx.$queryRaw<{ max: number | null }[]>`
      SELECT MAX(CAST(SUBSTRING(code FROM 6) AS INTEGER)) AS max
      FROM loss_cases WHERE code ~ '^LOSS-[0-9]+$'`;
    const next = Number(rows[0]?.max ?? 0) + 1;
    return `LOSS-${String(next).padStart(4, '0')}`;
  }

  insert(
    data: Prisma.LossCaseUncheckedCreateInput,
    tx: Prisma.TransactionClient,
  ): Promise<LossCaseRow> {
    return tx.lossCase.create({ data, select: LOSS_CASE_SELECT });
  }

  // Compare-and-set on state and version (design §2.1): null when another writer moved the case
  // first, so a manual confirm and the `devices.lossSearch` job never both confirm it.
  async transition(
    id: string,
    from: LossCaseState,
    version: number,
    data: Prisma.LossCaseUncheckedUpdateManyInput,
    tx: Prisma.TransactionClient,
  ): Promise<LossCaseRow | null> {
    const { count } = await tx.lossCase.updateMany({
      where: { id, state: from, version },
      data: { ...data, version: { increment: 1 } },
    });
    if (count !== 1) return null;
    return this.find(id, tx);
  }

  page(
    filter: LossCaseFilter,
    skip: number,
    take: number,
    client: Client = this.prisma,
  ): Promise<[LossCaseRow[], number]> {
    const where: Prisma.LossCaseWhereInput = {
      ...(filter.organizationId !== undefined ? { organizationId: filter.organizationId } : {}),
      ...(filter.state !== undefined ? { state: filter.state } : {}),
    };
    return Promise.all([
      client.lossCase.findMany({
        where,
        select: LOSS_CASE_SELECT,
        orderBy: [{ reportedAt: 'desc' }, { code: 'desc' }],
        skip,
        take,
      }),
      client.lossCase.count({ where }),
    ]);
  }

  // SEARCHING cases whose search window has passed (`devices.lossSearch`, REQ-EVT-15).
  async dueForConfirmation(at: Date, client: Client = this.prisma): Promise<string[]> {
    const rows = await client.lossCase.findMany({
      where: { state: LossCaseState.SEARCHING, searchEndsAt: { lte: at } },
      select: { id: true },
      orderBy: { searchEndsAt: 'asc' },
    });
    return rows.map((row) => row.id);
  }
}
