import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../shared/api/apiClient';
import type { DeviceStatus } from '../../shared/ui/status';
import { queryString, type Page } from '../../shared/api/query';

// Devices, hardware variants and maintenance records as devices api-design 01, 05 to 16 and
// monitoring api-design 07 return them (screens 4.2 and 4.3).

export interface Variant {
  id: string;
  code: string;
  name: string;
  hasGps: boolean;
  hasMotionSensor: boolean;
  mqttCapable: boolean;
  firmwareBaseline: string;
  remainingValueSchedule: { fromMonths: number; valueVnd: number }[];
  serviceIntervalDays: number | null;
  serviceChecklist: string[];
  isActive: boolean;
}

export interface Device {
  id: string;
  assetTag: string;
  nodeNum: number;
  nodeId: string;
  hardwareVariant: { id: string; code: string };
  firmwareVersion: string;
  acquiredAt: string;
  status: DeviceStatus;
  statusChangedAt: string;
  keyVersion: number | null;
  keyOrganizationId: string | null;
  keyOrganization: { id: string; code: string; legalName: string } | null;
  batteryPct: number | null;
  lastSeenAt: string | null;
  lastPosition: { lat: number; lon: number } | null;
  serviceDueAt: string | null;
  version: number;
}

export interface DeviceDetail extends Device {
  openMaintenance: MaintenanceRecord | null;
  lastIntakeCheck: { passed: boolean; createdAt: string } | null;
  lastReset: { createdAt: string } | null;
}

export interface DeviceHistoryItem {
  at: string;
  kind: 'STATE' | 'INTAKE' | 'PROVISIONING' | 'RESET' | 'INSPECTION' | 'MAINTENANCE' | 'CONTRACT';
  summary: string;
  actor: string;
  refType: string | null;
  refId: string | null;
}

export type MaintenanceReason =
  | 'STAFF_REPORTED'
  | 'SCHEDULED'
  | 'FIRMWARE_UPDATE'
  | 'INTAKE_FAILED'
  | 'INSPECTION_FAILED'
  | 'HANDOVER_CHECK_FAILED';

export type MaintenanceStatus = 'OPEN' | 'PENDING_APPROVAL' | 'COMPLETED' | 'UNREPAIRABLE';
export type WorkBy = 'IN_HOUSE' | 'VENDOR';

export interface MaintenanceRecord {
  id: string;
  device: { id: string; assetTag: string };
  reason: MaintenanceReason;
  status: MaintenanceStatus;
  description: string;
  expectedAt: string;
  workBy: WorkBy | null;
  vendorName: string | null;
  estimatedCostVnd: number | null;
  estimatedById: string | null;
  approvedCostVnd: number | null;
  decision: 'APPROVED' | 'REJECTED' | null;
  decisionReason: string | null;
  actualCostVnd: number | null;
  warrantyUntil: string | null;
  checklist: string[];
  checklistResults: { item: string; passed: boolean; note?: string }[] | null;
  firmwareVersion: string | null;
  resolution: string | null;
  openedAt: string;
  closedAt: string | null;
  version: number;
}

export const deviceKeys = {
  variants: ['hardware-variants'] as const,
  devices: (filters: DeviceFilters) => ['devices', filters] as const,
  device: (id: string) => ['device', id] as const,
  history: (id: string, pageNumber: number) => ['device-history', id, pageNumber] as const,
  maintenance: (filters: MaintenanceFilters) => ['maintenance', filters] as const,
  maintenanceApprovals: ['maintenance', 'approvals'] as const,
};

export const fetchVariants = (includeInactive = false) =>
  apiClient<Variant[]>(`/hardware-variants${queryString({ includeInactive })}`);

export const useVariants = (includeInactive = false) =>
  useQuery({ queryKey: [...deviceKeys.variants, includeInactive], queryFn: () => fetchVariants(includeInactive) });

export interface DeviceFilters {
  status?: DeviceStatus[];
  hardwareVariantId?: string;
  q?: string;
  pageNumber?: number;
}

export const fetchDevices = (filters: DeviceFilters) => {
  const query = new URLSearchParams({ pageSize: '20', pageNumber: String(filters.pageNumber ?? 1) });
  (filters.status ?? []).forEach((status) => query.append('status', status));
  if (filters.hardwareVariantId) query.set('hardwareVariantId', filters.hardwareVariantId);
  if (filters.q) query.set('q', filters.q);
  return apiClient<Page<Device>>(`/devices?${query.toString()}`);
};

export const useDevices = (filters: DeviceFilters) =>
  useQuery({ queryKey: deviceKeys.devices(filters), queryFn: () => fetchDevices(filters) });

export const fetchDevice = (id: string) => apiClient<DeviceDetail>(`/devices/${id}`);

export const useDevice = (id: string) =>
  useQuery({ queryKey: deviceKeys.device(id), queryFn: () => fetchDevice(id) });

export const fetchDeviceHistory = (id: string, pageNumber: number) =>
  apiClient<Page<DeviceHistoryItem>>(`/devices/${id}/history${queryString({ pageSize: 20, pageNumber })}`);

export const useDeviceHistory = (id: string, pageNumber: number) =>
  useQuery({ queryKey: deviceKeys.history(id, pageNumber), queryFn: () => fetchDeviceHistory(id, pageNumber) });

const post = <T>(endpoint: string, body: object): Promise<T> =>
  apiClient<T>(endpoint, { method: 'POST', body: JSON.stringify(body) });

const patch = <T>(endpoint: string, body: object): Promise<T> =>
  apiClient<T>(endpoint, { method: 'PATCH', body: JSON.stringify(body) });

// devices api-design 05.
export const registerDevice = (dto: {
  assetTag: string;
  nodeNum: string;
  hardwareVariantId: string;
  firmwareVersion: string;
  acquiredAt: string;
}) => post<Device>('/devices', dto);

// devices api-design 08.
export const editFirmware = (id: string, firmwareVersion: string, expectedVersion: number) =>
  patch<Device>(`/devices/${id}`, { firmwareVersion, expectedVersion });

// devices api-design 09. `motionOk` is included only for a motion-sensor variant.
export const recordIntakeCheck = (
  id: string,
  dto: {
    gpsFixOk: boolean;
    radioOk: boolean;
    batteryOk: boolean;
    motionOk?: boolean;
    note?: string;
    expectedVersion: number;
  },
) => post<{ check: { passed: boolean }; device: Device }>(`/devices/${id}/intake-checks`, dto);

// devices api-design 10: the three steps are always true (the button stays disabled otherwise).
export const recordReset = (id: string) =>
  post<Device>(`/devices/${id}/reset`, {
    keyRemoved: true,
    nodeDbCleared: true,
    ownerCleared: true,
  });

// devices api-design 16.
export const retireDevice = (id: string, reason: string, expectedVersion: number) =>
  post<Device>(`/devices/${id}/retire`, { reason, expectedVersion });

// devices api-design 23: the three wipe steps are always true (the button stays disabled otherwise).
export const disposeDevice = (id: string, method: string, expectedVersion: number) =>
  post<Device>(`/devices/${id}/dispose`, {
    keyRemoved: true,
    nodeDbCleared: true,
    ownerCleared: true,
    method,
    expectedVersion,
  });

export interface MaintenanceFilters {
  status?: MaintenanceStatus[];
  reason?: MaintenanceReason[];
  dueBefore?: string;
  pageNumber?: number;
}

export const fetchMaintenanceRecords = (filters: MaintenanceFilters) => {
  const query = new URLSearchParams({ pageSize: '20', pageNumber: String(filters.pageNumber ?? 1) });
  (filters.status ?? []).forEach((status) => query.append('status', status));
  (filters.reason ?? []).forEach((reason) => query.append('reason', reason));
  if (filters.dueBefore) query.set('dueBefore', filters.dueBefore);
  return apiClient<Page<MaintenanceRecord>>(`/maintenance-records?${query.toString()}`);
};

export const useMaintenanceRecords = (filters: MaintenanceFilters, enabled = true) =>
  useQuery({
    queryKey: deviceKeys.maintenance(filters),
    queryFn: () => fetchMaintenanceRecords(filters),
    enabled,
  });

// devices api-design 11.
export const openMaintenance = (
  deviceId: string,
  dto: {
    reason: 'STAFF_REPORTED';
    description: string;
    expectedAt: string;
    workBy?: WorkBy;
    vendorName?: string;
    estimatedCostVnd?: number;
    expectedVersion: number;
  },
) => post<{ record: MaintenanceRecord; device: Device }>(`/devices/${deviceId}/maintenance`, dto);

// devices api-design 12.
export const estimateMaintenance = (
  deviceId: string,
  recordId: string,
  dto: { workBy: WorkBy; vendorName?: string; estimatedCostVnd: number; expectedVersion: number },
) => patch<MaintenanceRecord>(`/devices/${deviceId}/maintenance/${recordId}/estimate`, dto);

// devices api-design 13.
export const decideMaintenance = (
  deviceId: string,
  recordId: string,
  dto: { decision: 'APPROVED' | 'REJECTED'; approvedCostVnd?: number; reason?: string; expectedVersion: number },
) => post<MaintenanceRecord>(`/devices/${deviceId}/maintenance/${recordId}/decision`, dto);

// devices api-design 14.
export const completeMaintenance = (
  deviceId: string,
  recordId: string,
  dto: {
    status: 'COMPLETED' | 'UNREPAIRABLE';
    resolution: string;
    actualCostVnd?: number;
    warrantyUntil?: string;
    checklistResults?: { item: string; passed: boolean; note?: string }[];
    firmwareVersion?: string;
    expectedVersion: number;
  },
) => patch<MaintenanceRecord>(`/devices/${deviceId}/maintenance/${recordId}`, dto);

// Monday-to-Sunday window containing `now`, as yyyy-mm-dd bounds for the week's service list.
export const weekEnd = (now: Date = new Date()): string => {
  const day = now.getDay();
  const toSunday = day === 0 ? 0 : 7 - day;
  const end = new Date(now);
  end.setDate(end.getDate() + toSunday);
  return end.toISOString().slice(0, 10);
};
