import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../shared/api/apiClient';
import { queryString, type Page } from '../../shared/api/query';
import type { ContractStatus, PlanType } from '../contract/api';
import type { UnitState } from '../live-map/api';

export interface DeviceGroupRef {
  id: string;
  name: string;
  parentId: string | null;
}

export interface DeviceGroup extends DeviceGroupRef {
  label: string | null;
  startsOn: string | null;
  endsOn: string | null;
  areaNote: string | null;
  version: number;
  deviceCount: number;
  children: DeviceGroup[];
}

export interface GroupTree {
  maxDepth: number;
  groups: DeviceGroup[];
}

export interface GroupFields {
  name: string;
  parentId: string | null;
  label: string | null;
  startsOn: string | null;
  endsOn: string | null;
  areaNote: string | null;
}

export interface RentedDevice {
  deviceId: string;
  assetTag: string;
  variantCode: string;
  contract: { id: string; code: string; planType: PlanType; status: ContractStatus };
  contractDeviceId: string;
  handedOverAt: string;
  state: UnitState;
  batteryPct: number | null;
  lastSeenAt: string | null;
  group: DeviceGroupRef | null;
  holder: { name: string } | null;
  openFaultReportId: string | null;
  openLossCase: { id: string; code: string; state: string } | null;
}

export interface RentedDeviceFilters {
  contractId?: string;
  groupId?: string;
  state?: UnitState;
  pageNumber?: number;
}

export interface DeviceFaultReport {
  id: string;
  deviceId: string;
  assetTag: string;
  description: string;
  reportedAt: string;
  resolvedAt: string | null;
  resolution: 'REPLACED' | 'CHECKED_IN' | 'LOST' | 'RELEASED' | null;
}

export const rentedDeviceKeys = {
  all: ['rented-devices'] as const,
  list: (filters: RentedDeviceFilters) => ['rented-devices', filters] as const,
  groups: ['groups'] as const,
  faults: (contractId: string) => ['fault-reports', contractId] as const,
};

export const useDeviceGroups = (enabled = true) =>
  useQuery({
    queryKey: rentedDeviceKeys.groups,
    queryFn: () => apiClient<GroupTree>('/groups'),
    enabled,
  });

export const useRentedDevices = (filters: RentedDeviceFilters) =>
  useQuery({
    queryKey: rentedDeviceKeys.list(filters),
    queryFn: () =>
      apiClient<Page<RentedDevice>>(`/rented-devices${queryString({ pageSize: 20, ...filters })}`),
  });

export const saveDeviceGroup = (fields: GroupFields, group?: DeviceGroup) =>
  apiClient<DeviceGroupRef>(group ? `/groups/${group.id}` : '/groups', {
    method: group ? 'PATCH' : 'POST',
    body: JSON.stringify(group ? { ...fields, expectedVersion: group.version } : fields),
  });

export const removeDeviceGroup = (id: string) =>
  apiClient<{ id: string; removedGroups: number; ungroupedDevices: number }>(`/groups/${id}`, {
    method: 'DELETE',
  });

export const assignDevices = (groupId: string, deviceIds: string[]) =>
  apiClient<{ groupId: string; assigned: string[]; unchanged: string[] }>(
    `/groups/${groupId}/devices`,
    {
      method: 'POST',
      body: JSON.stringify({ deviceIds }),
    },
  );

export const unassignDevice = (groupId: string, deviceId: string) =>
  apiClient(`/groups/${groupId}/devices/${deviceId}`, { method: 'DELETE' });

export const fetchFaultReports = (contractId: string) =>
  apiClient<DeviceFaultReport[]>(`/contracts/${contractId}/fault-reports`);

export const useFaultReports = (contractId: string, enabled = true) =>
  useQuery({
    queryKey: rentedDeviceKeys.faults(contractId),
    queryFn: () => fetchFaultReports(contractId),
    enabled,
  });

export const reportDeviceFault = (contractId: string, deviceId: string, description: string) =>
  apiClient<DeviceFaultReport>(`/contracts/${contractId}/devices/${deviceId}/fault-reports`, {
    method: 'POST',
    body: JSON.stringify({ description }),
  });

export const flattenGroups = (
  groups: DeviceGroup[],
  depth = 0,
): { group: DeviceGroup; depth: number }[] =>
  groups.flatMap((group) => [{ group, depth }, ...flattenGroups(group.children, depth + 1)]);
