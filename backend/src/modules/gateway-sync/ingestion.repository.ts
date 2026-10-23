import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

type Client = Prisma.TransactionClient | PrismaService;

export interface PlottedPosition {
  latitude: number;
  longitude: number;
  occurredAt: Date;
}

// The only class of `gateway-sync` that touches Prisma. Models: FieldEvent, SyncAuditLog,
// DeviceQueueReport (the `// @module gateway-sync` block).
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
}
