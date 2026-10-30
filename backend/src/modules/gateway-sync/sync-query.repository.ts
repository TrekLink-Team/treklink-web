import { Injectable } from '@nestjs/common';
import { Prisma, SyncOutcome } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

export const FIELD_EVENT_ROW = {
  seq: true,
  eventId: true,
  deviceId: true,
  organizationId: true,
  attribution: true,
  ingress: true,
  uplinkKey: true,
  kind: true,
  priority: true,
  observedAt: true,
  receivedAt: true,
  latitude: true,
  longitude: true,
  altitude: true,
  batteryPct: true,
  rssi: true,
  snr: true,
  hopsAway: true,
  plotted: true,
  incidentId: true,
} as const satisfies Prisma.FieldEventSelect;

export type FieldEventRow = Prisma.FieldEventGetPayload<{ select: typeof FIELD_EVENT_ROW }>;

// The reads of `gateway-sync` (api-design 03 and 07): the field-event ledger in `seq` order and the
// sync audit counts per outcome. Never writes.
@Injectable()
export class SyncQueryRepository {
  constructor(private readonly prisma: PrismaService) {}

  pageEvents(
    where: Prisma.FieldEventWhereInput,
    order: Prisma.SortOrder,
    skip: number,
    take: number,
  ): Promise<[FieldEventRow[], number]> {
    return Promise.all([
      this.prisma.fieldEvent.findMany({
        where,
        orderBy: { seq: order },
        skip,
        take,
        select: FIELD_EVENT_ROW,
      }),
      this.prisma.fieldEvent.count({ where }),
    ]);
  }

  async outcomesSince(since: Date): Promise<Map<SyncOutcome, number>> {
    const groups = await this.prisma.syncAuditLog.groupBy({
      by: ['outcome'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    });
    return new Map(groups.map((group) => [group.outcome, group._count._all]));
  }

  async lastReceivedAt(): Promise<Date | null> {
    const row = await this.prisma.fieldEvent.findFirst({
      orderBy: { seq: 'desc' },
      select: { receivedAt: true },
    });
    return row?.receivedAt ?? null;
  }
}
