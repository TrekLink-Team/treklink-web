import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

type Client = Prisma.TransactionClient | PrismaService;

// What a list, a create and a revoke show of a station (api-design 23, 24, 25). The secret hash never
// leaves this module except through `findByUsername` for the broker check.
export const STATION_VIEW = {
  id: true,
  name: true,
  mqttUsername: true,
  createdAt: true,
  revokedAt: true,
  lastSyncAt: true,
  queueDepth: true,
  oldestRetryCount: true,
  version: true,
} satisfies Prisma.FieldStationSelect;

export type FieldStationRow = Prisma.FieldStationGetPayload<{ select: typeof STATION_VIEW }>;

// What `gateway-sync` needs to accept or refuse a connection (broker auth, ingestion).
export interface StationCredential {
  id: string;
  organizationId: string;
  mqttUsername: string;
  secretHash: string;
  revokedAt: Date | null;
}

// The health a station reports every minute (FR-EVT-13, FR-EVT-18): events queued per priority
// (index 0 is P0), the retry count of the oldest queued event, and the executable's version.
export interface StationHealth {
  queueDepth: readonly [number, number, number, number];
  oldestRetryCount: number;
  version: string;
  at: Date;
}

// Field Station credentials (task 2.8). Every list and revoke is scoped to one organization.
@Injectable()
export class FieldStationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Newest first, revoked ones included (api-design 23).
  list(organizationId: string, client: Client = this.prisma): Promise<FieldStationRow[]> {
    return client.fieldStation.findMany({
      where: { organizationId },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      select: STATION_VIEW,
    });
  }

  countActive(organizationId: string, client: Client = this.prisma): Promise<number> {
    return client.fieldStation.count({ where: { organizationId, revokedAt: null } });
  }

  // The next number of `fs-<org code>-<n>`: one more than the highest used by the organization, revoked
  // stations included, so a username is never given twice. Read under the organization row lock.
  async nextNumber(organizationId: string, client: Client = this.prisma): Promise<number> {
    const rows = await client.fieldStation.findMany({
      where: { organizationId },
      select: { mqttUsername: true },
    });
    const numbers = rows.map((row) => Number(/-(\d+)$/.exec(row.mqttUsername)?.[1] ?? 0));
    return Math.max(0, ...numbers) + 1;
  }

  insert(
    row: {
      organizationId: string;
      name: string;
      mqttUsername: string;
      secretHash: string;
      createdById: string;
    },
    client: Client = this.prisma,
  ): Promise<FieldStationRow> {
    return client.fieldStation.create({ data: row, select: STATION_VIEW });
  }

  find(
    organizationId: string,
    id: string,
    client: Client = this.prisma,
  ): Promise<FieldStationRow | null> {
    return client.fieldStation.findFirst({ where: { id, organizationId }, select: STATION_VIEW });
  }

  // Sets the revocation once; null when the station was already revoked, so a second revoke is a no-op.
  async revoke(
    organizationId: string,
    id: string,
    by: string,
    at: Date,
    client: Client = this.prisma,
  ): Promise<FieldStationRow | null> {
    const { count } = await client.fieldStation.updateMany({
      where: { id, organizationId, revokedAt: null },
      data: { revokedAt: at, revokedById: by },
    });
    return count === 1 ? this.find(organizationId, id, client) : null;
  }

  findByUsername(
    mqttUsername: string,
    client: Client = this.prisma,
  ): Promise<StationCredential | null> {
    return client.fieldStation.findUnique({
      where: { mqttUsername },
      select: {
        id: true,
        organizationId: true,
        mqttUsername: true,
        secretHash: true,
        revokedAt: true,
      },
    });
  }

  async updateHealth(
    id: string,
    health: StationHealth,
    client: Client = this.prisma,
  ): Promise<void> {
    await client.fieldStation.update({
      where: { id },
      data: {
        lastSyncAt: health.at,
        queueDepth: [...health.queueDepth],
        oldestRetryCount: health.oldestRetryCount,
        version: health.version,
      },
    });
  }
}
