import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../shared/api/apiClient';
import { queryString } from '../../shared/api/query';
import type { IncidentState } from '../../shared/ui/status';

// The state of a unit on the map (monitoring REQ-UBI-04, D-092 rule 2): heard since its handover and
// recently, heard since its handover and silent past the threshold, or not heard since its handover.
export type UnitState = 'LIVE' | 'OFFLINE' | 'NOT_HEARD';

// Where a unit not heard since its handover is pinned: the TrekLink counter that handed it over.
export interface CounterLocation {
  name: string;
  lat: number;
  lon: number;
}

// One device of GET /api/map/snapshot (monitoring api-design 02).
export interface SnapshotDevice {
  id: string;
  assetTag: string;
  hardwareVariant: string;
  holder: { name: string } | null;
  position: { lat: number; lon: number; at: string } | null;
  batteryPct: number | null;
  lastSeenAt: string | null;
  stale: boolean;
  state: UnitState;
  /** The start of the custody interval; nothing from before it is shown to an organization. */
  handedOverAt: string;
  /** Set for a `NOT_HEARD` unit only. */
  counterLocation: CounterLocation | null;
  openIncident: { id: string; code: string | null; state: IncidentState } | null;
  contractCode: string;
  organizationId: string;
}

export interface SnapshotFieldStation {
  id: string;
  name: string;
  lastSyncAt: string | null;
  stale: boolean;
}

export interface MapSnapshot {
  cursor: number;
  devices: SnapshotDevice[];
  fieldStations: SnapshotFieldStation[];
}

// Screen 9.1 query keys: `replay.expired` invalidates every snapshot (LiveProvider).
export const mapSnapshotKey = (organizationId: string | null) =>
  ['map', 'snapshot', organizationId] as const;

export const getMapSnapshot = (organizationId: string | null): Promise<MapSnapshot> =>
  apiClient<MapSnapshot>(
    `/map/snapshot${queryString({ organizationId: organizationId ?? undefined })}`,
  );

// `organizationId` is the fleet map's filter; an organization's map passes null and the server
// scopes it to the caller's organization.
export const useMapSnapshot = (organizationId: string | null) =>
  useQuery({
    queryKey: mapSnapshotKey(organizationId),
    queryFn: () => getMapSnapshot(organizationId),
    // The stream keeps the map current while it is mounted; a refetch would only redraw what the
    // stream already moved.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    // The stream entries are kept only while the map is mounted, so a map shown again starts from a
    // fresh snapshot: an incident resolved on its own page no longer reads as an open SOS (smoke 3).
    refetchOnMount: 'always',
  });
