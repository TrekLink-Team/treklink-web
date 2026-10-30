import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../shared/api/apiClient';

// MF-02 sync status, as `POST /api/gateway-sync` op `syncStatus` returns it (gateway-sync api-design
// 07). TrekLink Staff and Admin only.
export type BrokerState = 'up' | 'down' | 'unknown';
export type StationConnection = 'CONNECTED' | 'STALE' | 'NEVER_REPORTED';

export interface QueueDepth {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
}

export interface SyncStation {
  id: string;
  name: string;
  mqttUsername: string;
  organization: { id: string; code: string; name: string };
  connection: StationConnection;
  lastSyncAt: string | null;
  lastFlushAt: string | null;
  queueDepth: QueueDepth;
  oldestRetryCount: number | null;
  version: string | null;
}

export interface SyncStatus {
  broker: { subscriber: BrokerState };
  staleAfterSeconds: number;
  fieldStations: SyncStation[];
  ingestion: {
    windowMinutes: number;
    accepted: number;
    acceptedUnattributed: number;
    duplicates: number;
    malformed: number;
    unknownDevice: number;
    lastReceivedAt: string | null;
  };
}

export const WINDOW_OPTIONS = [15, 60, 240] as const;
export type WindowMinutes = (typeof WINDOW_OPTIONS)[number];

export const fetchSyncStatus = (windowMinutes: WindowMinutes) =>
  apiClient<SyncStatus>('/gateway-sync', {
    method: 'POST',
    body: JSON.stringify({ op: 'syncStatus', windowMinutes }),
  });

export interface FieldEventRow {
  seq: number;
  eventId: string;
  deviceId: string;
  assetTag: string | null;
  organizationId: string | null;
  attribution: 'ATTRIBUTED' | 'UNATTRIBUTED';
  ingress: 'MQTT_NODE' | 'FIELD_STATION';
  uplinkKey: string;
  kind: 'TEXT' | 'POSITION' | 'TELEMETRY' | 'SOS' | 'FALL_SOS' | 'CHAT';
  priority: 'P0_SOS' | 'P1_LOCATION' | 'P2_GPS' | 'P3_TELEMETRY';
  receivedAt: string;
  latitude: number | null;
  longitude: number | null;
  batteryPct: number | null;
  plotted: boolean;
  incidentId: string | null;
}

export interface FieldEventPage {
  items: FieldEventRow[];
  pageNumber: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

// The most recent ingested readings (gateway-sync api-design 03), newest first, for the sync status
// page's log; not paged there beyond the first page.
export const fetchRecentEvents = (pageSize = 20) =>
  apiClient<FieldEventPage>('/gateway-sync', {
    method: 'POST',
    body: JSON.stringify({ op: 'listEvents', order: 'desc', pageSize }),
  });

export const useRecentEvents = () =>
  useQuery({
    queryKey: ['sync-status', 'recent-events'],
    queryFn: () => fetchRecentEvents(),
    refetchInterval: 30_000,
  });

export const syncStatusKeys = {
  all: ['sync-status'] as const,
  window: (windowMinutes: WindowMinutes) => ['sync-status', windowMinutes] as const,
};

// Polled every 30 s while the tab is visible, the same client choice as SystemHealthPage; MF-02 has no
// WebSocket event of its own yet.
export const useSyncStatus = (windowMinutes: WindowMinutes) =>
  useQuery({
    queryKey: syncStatusKeys.window(windowMinutes),
    queryFn: () => fetchSyncStatus(windowMinutes),
    refetchInterval: 30_000,
  });
