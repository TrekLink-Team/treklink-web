import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../shared/api/apiClient';
import { queryString } from '../../shared/api/query';

// The system health read as monitoring api-design 06 returns it (screen 9.3). TrekLink Admin only.
export type ComponentState = 'up' | 'down' | 'unknown';

export interface QueueDepth {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
}

export interface HealthStation {
  id: string;
  name: string;
  organization: { id: string; name: string };
  lastSyncAt: string | null;
  stale: boolean;
  queueDepth: QueueDepth;
  oldestRetryCount: number | null;
  version: string | null;
  outdated: boolean;
}

export interface SystemHealth {
  health: {
    status: 'ok' | 'degraded';
    components: { database: ComponentState; mqtt: ComponentState };
  };
  ingestion: {
    perMinute: number;
    accepted: number;
    duplicates: number;
    malformed: number;
    unknownDevice: number;
  };
  fieldStations: {
    total: number;
    stale: number;
    outdated: number;
    // Null when the release file cannot be read.
    currentRelease: string | null;
    maxQueueDepth: QueueDepth;
    items: HealthStation[];
  };
  devicesBuffering: number;
  alerts: { pending: number; failed: number };
}

// The window choices of the page; the endpoint takes any whole number of minutes up to a day.
export const HEALTH_WINDOWS = [15, 60, 240] as const;
export type HealthWindow = (typeof HEALTH_WINDOWS)[number];
export const DEFAULT_HEALTH_WINDOW: HealthWindow = 60;

// Polled while the tab is visible; `station.stale` also invalidates the key at once (ws-live-contract).
export const HEALTH_POLL_MS = 30_000;

export const healthKeys = {
  all: ['system-health'] as const,
  window: (windowMinutes: HealthWindow) => ['system-health', windowMinutes] as const,
};

export const fetchSystemHealth = (windowMinutes: HealthWindow) =>
  apiClient<SystemHealth>(`/system-health${queryString({ windowMinutes })}`);

export const useSystemHealth = (windowMinutes: HealthWindow) =>
  useQuery({
    queryKey: healthKeys.window(windowMinutes),
    queryFn: () => fetchSystemHealth(windowMinutes),
    refetchInterval: HEALTH_POLL_MS,
    retry: false,
  });
