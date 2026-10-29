import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

// One stream entry as the push and the REST replay carry it (ws-live-contract). `seq` is the cursor.
export interface StreamEntry {
  seq: number;
  organizationId: string | null;
  type: string;
  deviceId: string | null;
  payload: Prisma.JsonValue;
  createdAt: string;
}

export interface NewStreamEntry {
  organizationId: string | null;
  type: string;
  deviceId?: string | null;
  payload: Prisma.InputJsonValue;
}

type Row = Prisma.StreamEventGetPayload<Record<string, never>>;

// A cursor is a Postgres bigserial that stays far below 2^53, so it travels as a JSON number.
const toEntry = (row: Row): StreamEntry => ({
  seq: Number(row.seq),
  organizationId: row.organizationId,
  type: row.type,
  deviceId: row.deviceId,
  payload: row.payload,
  createdAt: row.createdAt.toISOString(),
});

// The only class of `monitoring` that touches Prisma (task 1.1). Model: the `// @module monitoring` block.
@Injectable()
export class StreamRepository {
  constructor(private readonly prisma: PrismaService) {}

  async insert(entry: NewStreamEntry): Promise<StreamEntry> {
    const row = await this.prisma.streamEvent.create({
      data: {
        organizationId: entry.organizationId,
        type: entry.type,
        deviceId: entry.deviceId ?? null,
        payload: entry.payload,
      },
    });
    return toEntry(row);
  }

  // Entries with `seq` above the cursor, oldest first. A null organization is the fleet's view of
  // every entry; an id is that organization's own entries only.
  async after(organizationId: string | null, seq: number, limit: number): Promise<StreamEntry[]> {
    const rows = await this.prisma.streamEvent.findMany({
      where: {
        seq: { gt: BigInt(seq) },
        ...(organizationId === null ? {} : { organizationId }),
      },
      orderBy: { seq: 'asc' },
      take: limit,
    });
    return rows.map(toEntry);
  }

  // Remembers a check-in, keeping the later one if a check-in is recorded twice or out of order.
  async recordRelease(organizationId: string, deviceId: string, checkedInAt: Date): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO "device_releases" ("organizationId", "deviceId", "checkedInAt")
      VALUES (${organizationId}, ${deviceId}, ${checkedInAt})
      ON CONFLICT ("organizationId", "deviceId")
      DO UPDATE SET "checkedInAt" = GREATEST("device_releases"."checkedInAt", EXCLUDED."checkedInAt")`;
  }

  // When the organization last checked the device in, or null if it never did. Kept in its own table, so
  // pruning the stream cannot lose it (REQ-EVT-04, AC-06).
  async latestRelease(organizationId: string, deviceId: string): Promise<Date | null> {
    const row = await this.prisma.deviceRelease.findUnique({
      where: { organizationId_deviceId: { organizationId, deviceId } },
      select: { checkedInAt: true },
    });
    return row?.checkedInAt ?? null;
  }

  // The newest cursor, or 0 when the stream is empty.
  async maxSeq(): Promise<number> {
    const { _max } = await this.prisma.streamEvent.aggregate({ _max: { seq: true } });
    return _max.seq === null ? 0 : Number(_max.seq);
  }
}
