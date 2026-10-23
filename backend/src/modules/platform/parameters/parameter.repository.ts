import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';

// The public shape of a parameter (specs/platform/api-design/02 and 03).
export const PARAMETER_SELECT = {
  key: true,
  value: true,
  valueType: true,
  bounds: true,
  unit: true,
  ownerModule: true,
  description: true,
  version: true,
  updatedAt: true,
} satisfies Prisma.BusinessParameterSelect;

export type ParameterRow = Prisma.BusinessParameterGetPayload<{ select: typeof PARAMETER_SELECT }>;

export const HISTORY_SELECT = {
  previousValue: true,
  newValue: true,
  changedById: true,
  reason: true,
  changedAt: true,
} satisfies Prisma.BusinessParameterHistorySelect;

export type HistoryRow = Prisma.BusinessParameterHistoryGetPayload<{
  select: typeof HISTORY_SELECT;
}>;

type Client = Prisma.TransactionClient | PrismaService;

@Injectable()
export class ParameterRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByKey(key: string, client: Client = this.prisma): Promise<ParameterRow | null> {
    return client.businessParameter.findUnique({ where: { key }, select: PARAMETER_SELECT });
  }

  // Row lock for the read-validate-write of an update (design §6); Prisma has no FOR UPDATE.
  async lockAndFind(key: string, tx: Prisma.TransactionClient): Promise<ParameterRow | null> {
    await tx.$queryRaw`SELECT 1 FROM "business_parameters" WHERE "key" = ${key} FOR UPDATE`;
    return this.findByKey(key, tx);
  }

  updateValue(
    key: string,
    value: Prisma.InputJsonValue,
    version: number,
    updatedById: string,
    tx: Prisma.TransactionClient,
  ): Promise<ParameterRow> {
    return tx.businessParameter.update({
      where: { key },
      data: { value, version, updatedById },
      select: PARAMETER_SELECT,
    });
  }

  async appendHistory(
    entry: {
      key: string;
      previousValue: Prisma.InputJsonValue;
      newValue: Prisma.InputJsonValue;
      changedById: string;
      reason: string | null;
    },
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.businessParameterHistory.create({ data: entry });
  }

  // One page of parameters, by owning module then key (api-design 02).
  page(
    where: Prisma.BusinessParameterWhereInput,
    skip: number,
    take: number,
  ): Promise<[ParameterRow[], number]> {
    return Promise.all([
      this.prisma.businessParameter.findMany({
        where,
        select: PARAMETER_SELECT,
        orderBy: [{ ownerModule: 'asc' }, { key: 'asc' }],
        skip,
        take,
      }),
      this.prisma.businessParameter.count({ where }),
    ]);
  }

  // One page of a parameter's history, newest first (api-design 04).
  historyPage(key: string, skip: number, take: number): Promise<[HistoryRow[], number]> {
    const where = { key };
    return Promise.all([
      this.prisma.businessParameterHistory.findMany({
        where,
        select: HISTORY_SELECT,
        orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.prisma.businessParameterHistory.count({ where }),
    ]);
  }
}
