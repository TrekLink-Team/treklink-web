import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../shared/api/apiClient';

// Field Station credentials and the current release, organizations api-design 23 to 26 (screen 3.5).

/** Queued events per priority; null until the station first reports (api-design 23). */
export interface QueueDepth {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
}

export interface FieldStation {
  id: string;
  name: string;
  mqttUsername: string;
  createdAt: string;
  revokedAt: string | null;
  lastSyncAt: string | null;
  queueDepth: QueueDepth | null;
  oldestRetryCount: number;
  version: string | null;
  outdated: boolean;
}

/** api-design 23: the list and the most active credentials the organization may hold. */
export interface FieldStationList {
  items: FieldStation[];
  limit: number;
}

/** api-design 24: the credential, shown once. It never enters the query cache. */
export interface CreatedFieldStation extends FieldStation {
  mqttSecret: string;
  brokerUrl: string;
}

export interface ReleaseFile {
  os: string;
  downloadUrl: string;
  sha256: string;
  sizeBytes: number;
}

/** api-design 26. */
export interface FieldStationRelease {
  version: string;
  publishedAt: string;
  files: ReleaseFile[];
}

// Query keys of the screen design 3.5.
export const fieldStationKeys = {
  list: (organizationId: string) => ['org-field-stations', organizationId] as const,
  release: (organizationId: string) => ['org-field-station-release', organizationId] as const,
};

/** Health has no push event, so the list polls while the tab is visible (SD 3.5 open point 1). */
export const FIELD_STATION_REFRESH_MS = 30_000;

export const useFieldStations = (organizationId: string | undefined) =>
  useQuery({
    queryKey: fieldStationKeys.list(organizationId ?? ''),
    queryFn: () => apiClient<FieldStationList>(`/organizations/${organizationId}/field-stations`),
    enabled: Boolean(organizationId),
    refetchInterval: FIELD_STATION_REFRESH_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

export const useFieldStationRelease = (organizationId: string | undefined) =>
  useQuery({
    queryKey: fieldStationKeys.release(organizationId ?? ''),
    queryFn: () =>
      apiClient<FieldStationRelease>(`/organizations/${organizationId}/field-stations/release`),
    enabled: Boolean(organizationId),
    retry: false,
  });

const post = <T>(endpoint: string, body: object): Promise<T> =>
  apiClient<T>(endpoint, { method: 'POST', body: JSON.stringify(body) });

// A plain call rather than a mutation, so the secret stays in the dialog's state only.
export const createFieldStation = (organizationId: string, name: string) =>
  post<CreatedFieldStation>(`/organizations/${organizationId}/field-stations`, { name });

export const revokeFieldStation = (organizationId: string, stationId: string, reason?: string) =>
  post<FieldStation>(
    `/organizations/${organizationId}/field-stations/${stationId}/revoke`,
    reason ? { reason } : {},
  );

// The release files are static downloads outside the envelope, served by the backend origin; a
// relative `downloadUrl` resolves against the API base without its `/api` path.
const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';

export const downloadHref = (downloadUrl: string): string =>
  /^https?:\/\//.test(downloadUrl) ? downloadUrl : new URL(downloadUrl, API_BASE).toString();
