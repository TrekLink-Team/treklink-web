import type { ContractsService, VisibleDevice } from '../rentals';

type ScopedDevice = { organizationId: string | null; deviceId: string };

export const incidentDeviceKey = ({ organizationId, deviceId }: ScopedDevice) =>
  `${organizationId}:${deviceId}`;

export async function incidentDeviceGroups(
  contracts: ContractsService,
  rows: readonly ScopedDevice[],
) {
  const keys = new Set<string>();
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.organizationId === null) continue;
    keys.add(incidentDeviceKey(row));
    ids.add(row.deviceId);
  }
  const groups = new Map<string, NonNullable<VisibleDevice['group']>>();
  if (ids.size === 0) return groups;
  const units = await contracts.visibleDevices({ organizationId: null, deviceIds: [...ids] });
  for (const unit of units) {
    const key = incidentDeviceKey(unit);
    if (unit.group && keys.has(key)) groups.set(key, unit.group);
  }
  return groups;
}
