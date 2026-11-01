import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

type Client = Prisma.TransactionClient | PrismaService;

export interface PlottedPosition {
  latitude: number;
  longitude: number;
  occurredAt: Date;
}

// The writer of `gateway-sync` (models FieldEvent, SyncAuditLog, DeviceQueueReport of the
// `// @module gateway-sync` block); the reads of api-design 03 and 07 are SyncQueryRepository.
@Injectable()
export class IngestionRepository {
  constructor(private readonly prisma: PrismaService) {}

  // INSERT ... ON CONFLICT ("eventId") DO NOTHING: false when the event is already stored (REQ-UBI-01).
  async insertEventOnce(
    data: Prisma.FieldEventUncheckedCreateInput,
    client: Client = this.prisma,
  ): Promise<boolean> {
    const { count } = await client.fieldEvent.createMany({ data: [data], skipDuplicates: true });
    return count === 1;
  }

  // The one-way link of an SOS to the incident it opened or joined (the append-only trigger allows it).
  async linkIncident(
    eventId: string,
    incidentId: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.fieldEvent.update({ where: { eventId }, data: { incidentId } });
  }

  async insertAudit(
    data: Prisma.SyncAuditLogUncheckedCreateInput,
    client: Client = this.prisma,
  ): Promise<void> {
    await client.syncAuditLog.create({ data });
  }

  // The device's last plotted position in ingestion order (seq), for the speed rule.
  async lastPlottedPosition(
    deviceId: string,
    client: Client = this.prisma,
  ): Promise<PlottedPosition | null> {
    const row = await client.fieldEvent.findFirst({
      where: { deviceId, plotted: true, latitude: { not: null }, longitude: { not: null } },
      orderBy: { seq: 'desc' },
      select: { latitude: true, longitude: true, occurredAt: true },
    });
    return row && row.latitude !== null && row.longitude !== null
      ? { latitude: row.latitude, longitude: row.longitude, occurredAt: row.occurredAt }
      : null;
  }

  // The occurrence times of the device's stored plotted positions in [from, to], oldest first, for
  // the cadence rule of incidents (`PositionHistory`, incidents design §4). The same positions that
  // ingestion hands to `onPosition`: kind POSITION, plotted, with a valid fix.
  async plottedPositionTimes(
    deviceId: string,
    from: Date,
    to: Date,
    client: Client = this.prisma,
  ): Promise<Date[]> {
    const rows = await client.fieldEvent.findMany({
      where: {
        deviceId,
        kind: 'POSITION',
        plotted: true,
        latitude: { not: null },
        occurredAt: { gte: from, lte: to },
      },
      orderBy: { occurredAt: 'asc' },
      select: { occurredAt: true },
    });
    return rows.map((row) => row.occurredAt);
  }
}
