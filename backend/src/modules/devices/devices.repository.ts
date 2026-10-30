import { Injectable } from '@nestjs/common';
import { DeviceStatus, InspectionResult, LossCaseState, Prisma } from '@prisma/client';
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

  // AVAILABLE units per variant, every variant listed even at zero.
  async availability(
    variantId: string | undefined,
    client: Client = this.prisma,
  ): Promise<{ hardwareVariantId: string; code: string; available: number }[]> {
    const [variants, counts] = await Promise.all([
      client.hardwareVariant.findMany({
        where: variantId ? { id: variantId } : { isActive: true },
        orderBy: { code: 'asc' },
        select: { id: true, code: true },
      }),
      client.device.groupBy({
        by: ['hardwareVariantId'],
        where: {
          status: DeviceStatus.AVAILABLE,
          ...(variantId ? { hardwareVariantId: variantId } : {}),
        },
        _count: { _all: true },
      }),
    ]);
    const countOf = new Map(counts.map((row) => [row.hardwareVariantId, row._count._all]));
    return variants.map((variant) => ({
      hardwareVariantId: variant.id,
      code: variant.code,
      available: countOf.get(variant.id) ?? 0,
    }));
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

  // Records that the organization's channel key at `keyVersion` was written to the device (D-021):
  // the device keeps only the version and the organization, and a DeviceProvisioning row the history.
  async recordProvisioning(
    provisioning: { deviceId: string; organizationId: string; keyVersion: number; actorId: string },
    at: Date,
    tx: Prisma.TransactionClient,
  ): Promise<ProvisionedDevice> {
    await tx.deviceProvisioning.create({
      data: {
        deviceId: provisioning.deviceId,
        organizationId: provisioning.organizationId,
        keyVersion: provisioning.keyVersion,
        provisionedById: provisioning.actorId,
        createdAt: at,
      },
    });
    return tx.device.update({
      where: { id: provisioning.deviceId },
      data: {
        keyVersion: provisioning.keyVersion,
        keyOrganizationId: provisioning.organizationId,
        provisionedAt: at,
      },
      select: PROVISIONED_SELECT,
    });
  }

  provisioning(ids: readonly string[], client: Client = this.prisma): Promise<ProvisionedDevice[]> {
    return client.device.findMany({ where: { id: { in: [...ids] } }, select: PROVISIONED_SELECT });
  }

  // Moves units from one status to another; a unit in any other status is left as it is.
  async moveStatus(
    ids: readonly string[],
    from: DeviceStatus,
    to: DeviceStatus,
    at: Date,
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    const { count } = await tx.device.updateMany({
      where: { id: { in: [...ids] }, status: from },
      data: { status: to, statusChangedAt: at, version: { increment: 1 } },
    });
    return count;
  }

  // Every variant, or only the active ones, by code.
  variants(activeOnly: boolean, client: Client = this.prisma): Promise<VariantSummary[]> {
    return client.hardwareVariant.findMany({
      where: activeOnly ? { isActive: true } : {},
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true, isActive: true },
    });
  }

  // devices api-design 01 (task 4.1 part): the variants with their sensors, firmware baseline,
  // remaining-value schedule and service plan, by code.
  variantCatalog(activeOnly: boolean, client: Client = this.prisma): Promise<VariantRow[]> {
    return client.hardwareVariant.findMany({
      where: activeOnly ? { isActive: true } : {},
      orderBy: { code: 'asc' },
      select: VARIANT_SELECT,
    });
  }

  findVariant(id: string, client: Client = this.prisma): Promise<VariantRow | null> {
    return client.hardwareVariant.findUnique({ where: { id }, select: VARIANT_SELECT });
  }

  // The device holding an asset tag or a node number, ever registered (REQ-ERR-01).
  findRegistered(assetTag: string, nodeNum: bigint, client: Client = this.prisma) {
    return client.device.findFirst({
      where: { OR: [{ assetTag: { equals: assetTag, mode: 'insensitive' } }, { nodeNum }] },
      select: { assetTag: true, nodeNum: true },
    });
  }

  // devices api-design 05: a new unit IN_INTAKE.
  insertDevice(
    data: {
      assetTag: string;
      nodeNum: bigint;
      hardwareVariantId: string;
      firmwareVersion: string;
      acquiredAt: Date;
      registeredById: string;
      statusChangedAt: Date;
    },
    tx: Prisma.TransactionClient,
  ): Promise<DeviceListRow> {
    return tx.device.create({
      data: { ...data, status: DeviceStatus.IN_INTAKE },
      select: LIST_SELECT,
    });
  }

  // devices api-design 06 (task 4.1 part, built by LongLP for the replacement of rentals 4.3): the
  // fleet by status, variant and asset tag, oldest change first.
  page(filter: DeviceFilter, skip: number, take: number): Promise<[DeviceListRow[], number]> {
    const where: Prisma.DeviceWhereInput = {
      ...(filter.statuses?.length ? { status: { in: filter.statuses } } : {}),
      ...(filter.hardwareVariantId ? { hardwareVariantId: filter.hardwareVariantId } : {}),
      ...(filter.q ? { assetTag: { contains: filter.q, mode: 'insensitive' } } : {}),
    };
    return this.prisma.$transaction([
      this.prisma.device.findMany({
        where,
        select: LIST_SELECT,
        orderBy: [{ assetTag: 'asc' }],
        skip,
        take,
      }),
      this.prisma.device.count({ where }),
    ]);
  }

  // Locks one unit for the rest of the caller's transaction, so two replacements cannot take it.
  async lockUnit(id: string, tx: Prisma.TransactionClient): Promise<UnitRow | null> {
    await tx.$queryRaw`SELECT "id" FROM "devices" WHERE "id" = ${id} FOR UPDATE`;
    return tx.device.findUnique({ where: { id }, select: UNIT_SELECT });
  }

  // A loss case still open on the unit (reported, searching or confirmed, not yet settled or
  // recovered).
  async hasOpenLossCase(deviceId: string, tx: Prisma.TransactionClient): Promise<boolean> {
    const open = await tx.lossCase.count({
      where: {
        deviceId,
        state: { in: [LossCaseState.REPORTED, LossCaseState.SEARCHING, LossCaseState.CONFIRMED] },
      },
    });
    return open > 0;
  }

  // Return, reset and inspection (task 2.4 part, built by LongLP for MF-05).
  findUnit(id: string, client: Client = this.prisma): Promise<UnitRow | null> {
    return client.device.findUnique({ where: { id }, select: UNIT_SELECT });
  }

  // The latest reset of a unit, null when it was never reset.
  async lastResetAt(deviceId: string, client: Client = this.prisma): Promise<Date | null> {
    const row = await client.deviceReset.findFirst({
      where: { deviceId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return row?.createdAt ?? null;
  }

  // Records the three reset steps and clears the organization key the unit carried (D-021).
  async insertReset(
    deviceId: string,
    steps: { keyRemoved: boolean; nodeDbCleared: boolean; ownerCleared: boolean },
    resetById: string,
    at: Date,
    tx: Prisma.TransactionClient,
  ): Promise<UnitRow> {
    await tx.deviceReset.create({ data: { deviceId, ...steps, resetById, createdAt: at } });
    return tx.device.update({
      where: { id: deviceId },
      data: { keyVersion: null, keyOrganizationId: null, version: { increment: 1 } },
      select: UNIT_SELECT,
    });
  }

  // Device detail (devices api-design 07, task 3.1): the fleet row plus what the detail page and the
  // intake and maintenance rules read from the variant.
  findDetail(id: string, client: Client = this.prisma): Promise<DeviceDetailRow | null> {
    return client.device.findUnique({ where: { id }, select: DETAIL_SELECT });
  }

  lastIntakeCheck(deviceId: string, client: Client = this.prisma) {
    return client.intakeCheck.findFirst({
      where: { deviceId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, passed: true, createdAt: true },
    });
  }

  lastReset(deviceId: string, client: Client = this.prisma) {
    return client.deviceReset.findFirst({
      where: { deviceId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, createdAt: true },
    });
  }

  // Moves one unit from one of `from` to `to` when it is still at `version`, for the manual endpoints
  // that carry expectedVersion. Returns whether it moved.
  async moveIfCurrent(
    id: string,
    version: number,
    from: readonly DeviceStatus[],
    to: DeviceStatus,
    at: Date,
    tx: Prisma.TransactionClient,
    extra: Prisma.DeviceUncheckedUpdateManyInput = {},
  ): Promise<boolean> {
    const { count } = await tx.device.updateMany({
      where: { id, version, status: { in: [...from] } },
      data: { ...extra, status: to, statusChangedAt: at, version: { increment: 1 } },
    });
    return count === 1;
  }

  // Firmware and next service date after maintenance (FR-DEV-17, FR-DEV-21); the status is unchanged.
  async updateService(
    id: string,
    data: { firmwareVersion?: string; serviceDueAt?: Date },
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    if (data.firmwareVersion === undefined && data.serviceDueAt === undefined) return;
    await tx.device.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  }

  insertIntakeCheck(
    data: {
      deviceId: string;
      gpsFixOk: boolean;
      radioOk: boolean;
      batteryOk: boolean;
      motionOk: boolean | null;
      passed: boolean;
      note: string | null;
      checkedById: string;
      createdAt: Date;
    },
    tx: Prisma.TransactionClient,
  ) {
    return tx.intakeCheck.create({ data, select: { id: true, passed: true, createdAt: true } });
  }

  // One row of the device's state history (design §2); actor null is SYSTEM.
  async insertTransition(
    data: {
      deviceId: string;
      fromStatus: DeviceStatus | null;
      toStatus: DeviceStatus;
      actorId: string | null;
      reason: string;
      refType?: string;
      refId?: string;
      createdAt: Date;
    },
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.deviceTransition.create({ data });
  }

  // The lifecycle rows of one device, for `trail()` (monitoring api-design 07).
  async lifecycle(deviceId: string, client: Client = this.prisma) {
    const [transitions, intakeChecks, provisionings, resets, inspections] = await Promise.all([
      client.deviceTransition.findMany({
        where: { deviceId },
        select: {
          id: true,
          fromStatus: true,
          toStatus: true,
          actorId: true,
          reason: true,
          refType: true,
          refId: true,
          createdAt: true,
        },
      }),
      client.intakeCheck.findMany({
        where: { deviceId },
        select: { id: true, passed: true, checkedById: true, createdAt: true },
      }),
      client.deviceProvisioning.findMany({
        where: { deviceId },
        select: {
          id: true,
          organizationId: true,
          keyVersion: true,
          provisionedById: true,
          createdAt: true,
        },
      }),
      client.deviceReset.findMany({
        where: { deviceId },
        select: { id: true, resetById: true, createdAt: true },
      }),
      client.inspection.findMany({
        where: { deviceId },
        select: { id: true, result: true, damageCodes: true, inspectorId: true, createdAt: true },
      }),
    ]);
    return { transitions, intakeChecks, provisionings, resets, inspections };
  }

  insertInspection(
    data: {
      deviceId: string;
      contractDeviceId: string | null;
      result: InspectionResult;
      damageCodes: string[];
      note: string | null;
      inspectorId: string;
      createdAt: Date;
    },
    tx: Prisma.TransactionClient,
  ) {
    return tx.inspection.create({
      data,
      select: { id: true, result: true, damageCodes: true, createdAt: true },
    });
  }
}

export const LIST_SELECT = {
  id: true,
  assetTag: true,
  nodeNum: true,
  firmwareVersion: true,
  acquiredAt: true,
  status: true,
  statusChangedAt: true,
  keyVersion: true,
  keyOrganizationId: true,
  batteryPct: true,
  lastSeenAt: true,
  lastLatitude: true,
  lastLongitude: true,
  serviceDueAt: true,
  version: true,
  hardwareVariant: { select: { id: true, code: true } },
} satisfies Prisma.DeviceSelect;

export type DeviceListRow = Prisma.DeviceGetPayload<{ select: typeof LIST_SELECT }>;

export const DETAIL_SELECT = {
  ...LIST_SELECT,
  hardwareVariant: {
    select: {
      id: true,
      code: true,
      hasMotionSensor: true,
      firmwareBaseline: true,
      serviceIntervalDays: true,
    },
  },
} satisfies Prisma.DeviceSelect;

export type DeviceDetailRow = Prisma.DeviceGetPayload<{ select: typeof DETAIL_SELECT }>;

export interface DeviceFilter {
  statuses?: DeviceStatus[];
  hardwareVariantId?: string;
  q?: string;
}

export const UNIT_SELECT = {
  id: true,
  assetTag: true,
  hardwareVariantId: true,
  status: true,
  statusChangedAt: true,
  keyVersion: true,
  keyOrganizationId: true,
  version: true,
} satisfies Prisma.DeviceSelect;

export type UnitRow = Prisma.DeviceGetPayload<{ select: typeof UNIT_SELECT }>;

export const PROVISIONED_SELECT = {
  id: true,
  assetTag: true,
  status: true,
  keyVersion: true,
  keyOrganizationId: true,
  provisionedAt: true,
  batteryPct: true,
} satisfies Prisma.DeviceSelect;

export type ProvisionedDevice = Prisma.DeviceGetPayload<{ select: typeof PROVISIONED_SELECT }>;

export interface DeviceTag {
  id: string;
  assetTag: string;
}

export const VARIANT_SELECT = {
  id: true,
  code: true,
  name: true,
  hasGps: true,
  hasMotionSensor: true,
  mqttCapable: true,
  firmwareBaseline: true,
  remainingValueSchedule: true,
  serviceIntervalDays: true,
  serviceChecklist: true,
  isActive: true,
} satisfies Prisma.HardwareVariantSelect;

export type VariantRow = Prisma.HardwareVariantGetPayload<{ select: typeof VARIANT_SELECT }>;

export interface VariantSummary {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}
