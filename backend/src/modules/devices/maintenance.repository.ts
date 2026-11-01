import { Injectable } from '@nestjs/common';
import { MaintenanceStatus, MaintenanceWorkBy, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

type Client = Prisma.TransactionClient | PrismaService;

// The reasons a record is opened with (schema comment on MaintenanceRecord.reason). Staff open
// STAFF_REPORTED; the weekly scan and a passed inspection of a due unit open SCHEDULED and
// FIRMWARE_UPDATE; a failed intake or inspection opens INTAKE_FAILED or INSPECTION_FAILED.
export const MAINTENANCE_REASONS = [
  'STAFF_REPORTED',
  'SCHEDULED',
  'FIRMWARE_UPDATE',
  'INTAKE_FAILED',
  'INSPECTION_FAILED',
  'HANDOVER_CHECK_FAILED',
] as const;
export type MaintenanceReason = (typeof MAINTENANCE_REASONS)[number];

export const OPEN_STATUSES: MaintenanceStatus[] = [
  MaintenanceStatus.OPEN,
  MaintenanceStatus.PENDING_APPROVAL,
];

export const RECORD_SELECT = {
  id: true,
  deviceId: true,
  reason: true,
  status: true,
  description: true,
  expectedAt: true,
  workBy: true,
  vendorName: true,
  estimatedCostVnd: true,
  estimatedById: true,
  approvedCostVnd: true,
  decision: true,
  decisionReason: true,
  actualCostVnd: true,
  warrantyUntil: true,
  checklistResults: true,
  firmwareVersion: true,
  resolution: true,
  openedAt: true,
  closedAt: true,
  version: true,
  device: {
    select: {
      id: true,
      assetTag: true,
      hardwareVariant: { select: { serviceChecklist: true, serviceIntervalDays: true } },
    },
  },
} satisfies Prisma.MaintenanceRecordSelect;

export type RecordRow = Prisma.MaintenanceRecordGetPayload<{ select: typeof RECORD_SELECT }>;

export interface NewRecord {
  deviceId: string;
  reason: MaintenanceReason;
  status: MaintenanceStatus;
  description: string;
  expectedAt: Date;
  workBy: MaintenanceWorkBy | null;
  vendorName: string | null;
  estimatedCostVnd: bigint | null;
  estimatedById: string | null;
  openedById: string | null;
  openedAt: Date;
}

export interface RecordFilter {
  statuses?: MaintenanceStatus[];
  reasons?: string[];
  deviceId?: string;
  // Records expected to finish on or before this day (the week's service list).
  expectedBy?: Date;
}

// Maintenance records of the `// @module devices` block (task 2.8). Every write compares the record's
// version, so a stale caller changes nothing and the service answers 409 STALE_VERSION.
@Injectable()
export class MaintenanceRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: NewRecord, tx: Prisma.TransactionClient): Promise<RecordRow> {
    return tx.maintenanceRecord.create({ data, select: RECORD_SELECT });
  }

  find(id: string, client: Client = this.prisma): Promise<RecordRow | null> {
    return client.maintenanceRecord.findUnique({ where: { id }, select: RECORD_SELECT });
  }

  // The record a device still has open (OPEN or PENDING_APPROVAL); at most one per device
  // (`maintenance_records_one_open_per_device`).
  findOpen(deviceId: string, client: Client = this.prisma): Promise<RecordRow | null> {
    return client.maintenanceRecord.findFirst({
      where: { deviceId, status: { in: OPEN_STATUSES } },
      select: RECORD_SELECT,
    });
  }

  // The units among these with an open record (devices REQ-EVT-23).
  async openDeviceIds(
    deviceIds: readonly string[],
    client: Client = this.prisma,
  ): Promise<Set<string>> {
    if (deviceIds.length === 0) return new Set();
    const rows = await client.maintenanceRecord.findMany({
      where: { deviceId: { in: [...deviceIds] }, status: { in: OPEN_STATUSES } },
      select: { deviceId: true },
    });
    return new Set(rows.map((row) => row.deviceId));
  }

  // Applies `data` when the record is still at `version` and in one of `from`; false otherwise.
  async updateIfCurrent(
    id: string,
    version: number,
    from: MaintenanceStatus[],
    data: Prisma.MaintenanceRecordUncheckedUpdateManyInput,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    const { count } = await tx.maintenanceRecord.updateMany({
      where: { id, version, status: { in: from } },
      data: { ...data, version: { increment: 1 } },
    });
    return count === 1;
  }

  page(filter: RecordFilter, skip: number, take: number): Promise<[RecordRow[], number]> {
    const where: Prisma.MaintenanceRecordWhereInput = {
      ...(filter.statuses?.length ? { status: { in: filter.statuses } } : {}),
      ...(filter.reasons?.length ? { reason: { in: filter.reasons } } : {}),
      ...(filter.deviceId ? { deviceId: filter.deviceId } : {}),
      ...(filter.expectedBy ? { expectedAt: { lte: filter.expectedBy } } : {}),
    };
    return this.prisma.$transaction([
      this.prisma.maintenanceRecord.findMany({
        where,
        select: RECORD_SELECT,
        orderBy: [{ expectedAt: 'asc' }, { openedAt: 'asc' }],
        skip,
        take,
      }),
      this.prisma.maintenanceRecord.count({ where }),
    ]);
  }

  // Every record of a device, for its lifecycle history (monitoring api-design 07).
  ofDevice(deviceId: string, client: Client = this.prisma) {
    return client.maintenanceRecord.findMany({
      where: { deviceId },
      orderBy: { openedAt: 'asc' },
      select: {
        id: true,
        reason: true,
        status: true,
        openedAt: true,
        openedById: true,
        closedAt: true,
        closedById: true,
      },
    });
  }
}
