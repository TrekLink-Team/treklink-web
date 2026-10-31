import { keepPreviousData, useQuery } from '@tanstack/react-query';
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
    normalizationFailed: number;
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

// The sync audit, as `POST /api/gateway-sync` op `listAudit` returns it (gateway-sync api-design 04):
// one row per ingestion attempt, newest first. TrekLink Staff and Admin only.
export const SYNC_OUTCOMES = [
  'ACCEPTED',
  'ACCEPTED_UNATTRIBUTED',
  'DUPLICATE_REJECTED',
  'MALFORMED_ENVELOPE',
  'NORMALIZATION_FAILED',
  'UNKNOWN_DEVICE',
  'NOT_RENTED_TO_STATION_ORG',
  'INVALID_POSITION',
  'IMPLAUSIBLE_POSITION',
  'QUEUE_REPORT',
] as const;
export type SyncOutcome = (typeof SYNC_OUTCOMES)[number];

export interface SyncAuditRow {
  id: string;
  eventId: string | null;
  nodeNum: number | null;
  deviceId: string | null;
  assetTag: string | null;
  uplinkKey: string | null;
  ingress: 'MQTT_NODE' | 'FIELD_STATION';
  outcome: SyncOutcome;
  detail: string | null;
  // The raw payload of a MALFORMED_ENVELOPE row, cut by the server; null for any other outcome.
  rawExcerpt: string | null;
  rawTruncated: boolean;
  createdAt: string;
}

export interface SyncAuditPage {
  items: SyncAuditRow[];
  pageNumber: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

// The page size of the audit list on the sync page, a client choice within api-design 04's bound.
export const AUDIT_PAGE_SIZE = 20;

export interface SyncAuditQuery {
  outcome?: SyncOutcome;
  pageNumber: number;
}

export const fetchSyncAudit = ({ outcome, pageNumber }: SyncAuditQuery) =>
  apiClient<SyncAuditPage>('/gateway-sync', {
    method: 'POST',
    body: JSON.stringify({
      op: 'listAudit',
      ...(outcome ? { outcome: [outcome] } : {}),
      pageNumber,
      pageSize: AUDIT_PAGE_SIZE,
    }),
  });

export const syncAuditKeys = {
  all: ['sync-status', 'audit'] as const,
  page: (query: SyncAuditQuery) =>
    ['sync-status', 'audit', query.outcome ?? 'all', query.pageNumber] as const,
};

// Polled with the rest of the page; the previous page stays on screen while the next one loads.
export const useSyncAudit = (query: SyncAuditQuery) =>
  useQuery({
    queryKey: syncAuditKeys.page(query),
    queryFn: () => fetchSyncAudit(query),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
