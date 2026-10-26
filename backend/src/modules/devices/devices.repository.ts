import { Injectable } from '@nestjs/common';
import { DeviceStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

type Client = Prisma.TransactionClient | PrismaService;

export interface DeviceIdentity {
  id: string;
  assetTag: string;
  nodeNum: bigint;
  status: DeviceStatus;
}

export interface DeviceProjection extends DeviceIdentity {
  variantCode: string;
  lastSeenAt: Date | null;
  batteryPct: number | null;
  lastLatitude: number | null;
  lastLongitude: number | null;
}

export interface ProjectionUpdate {
  at: Date;
  latitude?: number;
  longitude?: number;
  batteryPct?: number;
}

const IDENTITY = { id: true, assetTag: true, nodeNum: true, status: true } as const;

// The only class of `devices` that touches Prisma (task 1.1). Models: the `// @module devices` block.
// Grows with tasks 2.1 to 2.8 (variants, intake, reservation, loss cases, maintenance).
@Injectable()
export class DevicesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByNodeNum(nodeNum: bigint, client: Client = this.prisma): Promise<DeviceIdentity | null> {
    return client.device.findUnique({ where: { nodeNum }, select: IDENTITY });
  }

  // Applies a reading unless it is older than the stored last-seen time, in one statement, so two
  // concurrent ingestions cannot move the projection backwards (REQ-EVT-08). A reading of the same second
  // applies: a node sends its position and telemetry together, and dropping the second would lose the
  // battery. Returns whether it applied.
  async projectIfNewer(
    id: string,
    update: ProjectionUpdate,
    client: Client = this.prisma,
  ): Promise<boolean> {
    const { count } = await client.device.updateMany({
      where: { id, OR: [{ lastSeenAt: null }, { lastSeenAt: { lte: update.at } }] },
      data: {
        lastSeenAt: update.at,
        ...(update.latitude !== undefined && update.longitude !== undefined
          ? { lastLatitude: update.latitude, lastLongitude: update.longitude }
          : {}),
        ...(update.batteryPct !== undefined ? { batteryPct: update.batteryPct } : {}),
      },
    });
    return count === 1;
  }

  async projections(
    ids: readonly string[],
    client: Client = this.prisma,
  ): Promise<DeviceProjection[]> {
    const rows = await client.device.findMany({
      where: { id: { in: [...ids] } },
      select: {
        ...IDENTITY,
        lastSeenAt: true,
        batteryPct: true,
        lastLatitude: true,
        lastLongitude: true,
        hardwareVariant: { select: { code: true } },
      },
      orderBy: { assetTag: 'asc' },
    });
    return rows.map(({ hardwareVariant, ...row }) => ({
      ...row,
      variantCode: hardwareVariant.code,
    }));
  }

  findValuation(
    id: string,
    client: Client = this.prisma,
  ): Promise<{
    acquiredAt: Date;
    hardwareVariant: { remainingValueSchedule: Prisma.JsonValue };
  } | null> {
    return client.device.findUnique({
      where: { id },
      select: { acquiredAt: true, hardwareVariant: { select: { remainingValueSchedule: true } } },
    });
  }

  // Reserves up to `quantity` AVAILABLE devices of the variant, the longest unchanged first, under row
  // locks that skip units another approval holds, so two concurrent approvals never take the same
  // unit (BR-03). Returns the units taken; fewer than asked means the caller must roll back.
  async reserveAvailable(
    variantId: string,
    quantity: number,
    at: Date,
    tx: Prisma.TransactionClient,
  ): Promise<DeviceTag[]> {
    const picked = await tx.$queryRaw<DeviceTag[]>`
      SELECT "id", "assetTag" FROM "devices"
      WHERE "hardwareVariantId" = ${variantId} AND "status" = 'AVAILABLE'::"DeviceStatus"
      ORDER BY "statusChangedAt" ASC, "assetTag" ASC
      LIMIT ${quantity}
      FOR UPDATE SKIP LOCKED`;
    if (picked.length === quantity) {
      await tx.device.updateMany({
        where: { id: { in: picked.map((device) => device.id) } },
        data: { status: DeviceStatus.RESERVED, statusChangedAt: at, version: { increment: 1 } },
      });
    }
    return picked;
  }

  countAvailable(variantId: string, client: Client = this.prisma): Promise<number> {
    return client.device.count({
      where: { hardwareVariantId: variantId, status: DeviceStatus.AVAILABLE },
    });
  }

  // Returns RESERVED units to AVAILABLE; a unit in any other state is left as it is.
  async releaseReserved(
    ids: readonly string[],
    at: Date,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.device.updateMany({
      where: { id: { in: [...ids] }, status: DeviceStatus.RESERVED },
      data: { status: DeviceStatus.AVAILABLE, statusChangedAt: at, version: { increment: 1 } },
    });
  }

  tags(ids: readonly string[], client: Client = this.prisma): Promise<DeviceTag[]> {
    return client.device.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, assetTag: true },
    });
  }

  // Every variant, or only the active ones, by code.
  variants(activeOnly: boolean, client: Client = this.prisma): Promise<VariantSummary[]> {
    return client.hardwareVariant.findMany({
      where: activeOnly ? { isActive: true } : {},
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true, isActive: true },
    });
  }
}

export interface DeviceTag {
  id: string;
  assetTag: string;
}

export interface VariantSummary {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}
