import { DeviceListRow } from './devices.repository';
import { RecordRow } from './maintenance.repository';
import { toNodeId } from './node-id';

const DAY_MS = 24 * 60 * 60 * 1000;
// Business dates (service due, expected completion) are calendar days in Vietnam, UTC+7, the zone the
// platform's daily jobs run in (platform design §4.6).
const BUSINESS_ZONE_OFFSET_MS = 7 * 60 * 60 * 1000;

// The calendar day of `at` in UTC+7, as midnight UTC: the value a `@db.Date` column stores.
export const businessDay = (at: Date): Date => {
  const local = new Date(at.getTime() + BUSINESS_ZONE_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
};

export const addDays = (day: Date, days: number): Date => new Date(day.getTime() + days * DAY_MS);

// `YYYY-MM-DD` of a date column, or null.
export const dayString = (day: Date | null): string | null =>
  day ? day.toISOString().slice(0, 10) : null;

// `YYYY-MM-DD` from a request into the midnight-UTC value of a date column.
export const parseDay = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

const toNumber = (value: bigint | null): number | null => (value === null ? null : Number(value));

// One device as devices api-design 05 to 09 return it (the DEVICE shape of the catalog).
export const toDeviceView = (row: DeviceListRow) => ({
  id: row.id,
  assetTag: row.assetTag,
  nodeNum: Number(row.nodeNum),
  nodeId: toNodeId(row.nodeNum),
  hardwareVariant: { id: row.hardwareVariant.id, code: row.hardwareVariant.code },
  firmwareVersion: row.firmwareVersion,
  acquiredAt: row.acquiredAt,
  status: row.status,
  statusChangedAt: row.statusChangedAt,
  keyVersion: row.keyVersion,
  keyOrganizationId: row.keyOrganizationId,
  batteryPct: row.batteryPct,
  lastSeenAt: row.lastSeenAt,
  lastPosition:
    row.lastLatitude !== null && row.lastLongitude !== null
      ? { lat: row.lastLatitude, lon: row.lastLongitude }
      : null,
  serviceDueAt: dayString(row.serviceDueAt),
  version: row.version,
});

export type DeviceView = ReturnType<typeof toDeviceView>;

// One maintenance record as devices api-design 11 to 15 return it (the MREC shape of the catalog).
// `checklist` is the variant's service checklist, so the completion form needs no second read.
export const toRecordView = (row: RecordRow) => ({
  id: row.id,
  device: { id: row.device.id, assetTag: row.device.assetTag },
  reason: row.reason,
  status: row.status,
  description: row.description,
  expectedAt: dayString(row.expectedAt),
  workBy: row.workBy,
  vendorName: row.vendorName,
  estimatedCostVnd: toNumber(row.estimatedCostVnd),
  estimatedById: row.estimatedById,
  approvedCostVnd: toNumber(row.approvedCostVnd),
  decision: row.decision,
  decisionReason: row.decisionReason,
  actualCostVnd: toNumber(row.actualCostVnd),
  warrantyUntil: dayString(row.warrantyUntil),
  checklist: row.device.hardwareVariant.serviceChecklist,
  checklistResults: row.checklistResults,
  firmwareVersion: row.firmwareVersion,
  resolution: row.resolution,
  openedAt: row.openedAt,
  closedAt: row.closedAt,
  version: row.version,
});

export type RecordView = ReturnType<typeof toRecordView>;
