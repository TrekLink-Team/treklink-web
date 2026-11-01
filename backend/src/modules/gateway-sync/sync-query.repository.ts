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

export const SYNC_AUDIT_ROW = {
  id: true,
  eventId: true,
  nodeNum: true,
  deviceId: true,
  uplinkKey: true,
  ingress: true,
  outcome: true,
  detail: true,
  rawMessage: true,
  createdAt: true,
} as const satisfies Prisma.SyncAuditLogSelect;

export type SyncAuditRow = Prisma.SyncAuditLogGetPayload<{ select: typeof SYNC_AUDIT_ROW }>;

// The reads of `gateway-sync` (api-design 03, 04 and 07): the field-event ledger in `seq` order, the
// sync audit rows newest first and the sync audit counts per outcome. Never writes.
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

  // Positions and telemetry of one device by occurrence time, oldest first (monitoring api-design 03),
  // at most `take` rows; the caller passes one more than its cap to learn whether the range holds more.
  historyRows(where: Prisma.FieldEventWhereInput, take: number) {
    return this.prisma.fieldEvent.findMany({
      where,
      orderBy: [{ occurredAt: 'asc' }, { seq: 'asc' }],
      take,
      select: {
        occurredAt: true,
        kind: true,
        latitude: true,
        longitude: true,
        altitude: true,
        batteryPct: true,
      },
    });
  }

  // Sync audit rows newest first, `id` breaking a tie of `createdAt` so paging is stable.
  pageAudit(
    where: Prisma.SyncAuditLogWhereInput,
    skip: number,
    take: number,
  ): Promise<[SyncAuditRow[], number]> {
    return Promise.all([
      this.prisma.syncAuditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
        select: SYNC_AUDIT_ROW,
      }),
      this.prisma.syncAuditLog.count({ where }),
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

  // Devices whose newest queue report holds messages: total depth above zero (REQ-EVT-13). One row per
  // device, the latest by `receivedAt`, so a device that drained since its last report is not counted.
  async devicesBuffering(): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) AS "count"
      FROM (
        SELECT DISTINCT ON ("deviceId") "depth"
        FROM "device_queue_reports"
        ORDER BY "deviceId", "receivedAt" DESC
      ) latest
      WHERE (SELECT COALESCE(SUM(d), 0) FROM unnest(latest."depth") AS d) > 0
    `;
    return Number(rows[0]?.count ?? 0);
  }

  async lastReceivedAt(): Promise<Date | null> {
    const row = await this.prisma.fieldEvent.findFirst({
      orderBy: { seq: 'desc' },
      select: { receivedAt: true },
    });
    return row?.receivedAt ?? null;
  }
}
