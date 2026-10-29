import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../shared/api/apiClient';
import { formatDateTime } from '../../shared/lib/format';
import type { IncidentConfidence, IncidentState } from '../../shared/ui/status';
import { queryString, type Page } from '../contract/api';

// Incidents as incidents api-design 01 to 07 return them.
export interface PersonRef {
  id: string;
  fullName: string | null;
}

export interface Incident {
  id: string;
  code: string;
  device: {
    id: string;
    assetTag: string | null;
    holder: { name: string; phone: string | null } | null;
  };
  organizationId: string | null;
  contractId: string | null;
  state: IncidentState;
  stateChangedAt: string;
  source: 'DEVICE_SOS' | 'DEVICE_FALL' | 'CADENCE_INFERRED';
  confidence: IncidentConfidence;
  firstEventAt: string;
  lastEventAt: string;
  eventCount: number;
  lastPosition: { lat: number; lon: number } | null;
  stale: boolean;
  owner: PersonRef | null;
  tierDeadlineAt: string | null;
  statusDueAt: string | null;
  reopenCount: number;
  version: number;
}

export interface IncidentDetail extends Incident {
  statusUpdates: { id: string; note: string; author: PersonRef; createdAt: string }[];
  authorityReports: {
    id: string;
    agency: string;
    reference: string;
    reportedAt: string;
    caseClosedAt: string | null;
  }[];
}

export interface IncidentFilters {
  state?: IncidentState;
  open?: boolean;
  deviceId?: string;
  from?: string;
  pageNumber?: number;
}

export const SOURCE_LABEL: Record<Incident['source'], string> = {
  DEVICE_SOS: 'SOS button',
  DEVICE_FALL: 'Fall detected',
  CADENCE_INFERRED: 'Inferred from position cadence',
};

// Screen 8.1 disclaimer (chapter 06 §8).
export const SAR_DISCLAIMER =
  'TrekLink does not replace official search-and-rescue channels. Your organization remains responsible for its own emergency response.';

// LiveProvider invalidates ['incident', id] and ['incidents'] on `incident.changed`.
export const incidentKeys = {
  all: ['incidents'] as const,
  list: (filters: IncidentFilters) => ['incidents', filters] as const,
  detail: (id: string) => ['incident', id] as const,
};

export const fetchIncidents = (filters: IncidentFilters) =>
  apiClient<Page<Incident>>(`/incidents${queryString({ pageSize: 20, ...filters })}`);

export const fetchIncident = (id: string) => apiClient<IncidentDetail>(`/incidents/${id}`);

export const useIncidents = (filters: IncidentFilters) =>
  useQuery({ queryKey: incidentKeys.list(filters), queryFn: () => fetchIncidents(filters) });

export const useIncident = (id: string) =>
  useQuery({ queryKey: incidentKeys.detail(id), queryFn: () => fetchIncident(id) });

const post = <T>(endpoint: string, body: object): Promise<T> =>
  apiClient<T>(endpoint, { method: 'POST', body: JSON.stringify(body) });

// api-design 03 to 07. A POST is never retried after a network loss (screen 8.1).
export const acknowledge = (id: string, expectedVersion: number, note?: string) =>
  post<Incident>(
    `/incidents/${id}/acknowledge`,
    note ? { expectedVersion, note } : { expectedVersion },
  );

export const markResponding = (id: string, expectedVersion: number, note: string) =>
  post<Incident>(`/incidents/${id}/responding`, { expectedVersion, note });

export const addStatus = (id: string, note: string) =>
  post<{ id: string; note: string; createdAt: string; statusDueAt: string }>(
    `/incidents/${id}/status-updates`,
    { note },
  );

export const resolve = (id: string, expectedVersion: number, outcomeNote: string) =>
  post<Incident>(`/incidents/${id}/resolve`, { expectedVersion, outcomeNote });

export const declareFalseAlarm = (id: string, expectedVersion: number, reason: string) =>
  post<Incident>(`/incidents/${id}/false-alarm`, { expectedVersion, reason });

// The pending deadline of an incident, as text; expiry refetches, never moves state locally.
export const deadlineOf = (incident: Incident): string =>
  incident.tierDeadlineAt
    ? `Acknowledge by ${formatDateTime(incident.tierDeadlineAt)}`
    : incident.statusDueAt
      ? `Next update by ${formatDateTime(incident.statusDueAt)}`
      : 'No pending deadline';

const NOTIFYING = new Set<IncidentState>(['NOTIFY_PRIMARY', 'NOTIFY_BACKUP', 'NOTIFY_MANAGER']);
const OWNED = new Set<IncidentState>(['ACKNOWLEDGED', 'RESPONDING']);

export type IncidentAction = 'acknowledge' | 'responding' | 'status' | 'resolve' | 'falseAlarm';

// The state-and-viewer table of screen 8.1: the actions an organization member may take.
export const actionsFor = (incident: Incident, viewerId: string | undefined): IncidentAction[] => {
  const { state } = incident;
  const mine = incident.owner !== null && incident.owner.id === viewerId;
  if (NOTIFYING.has(state)) return ['acknowledge', 'falseAlarm'];
  if (state === 'ESCALATED' || state === 'REPORTED') return ['acknowledge'];
  if (state === 'ACKNOWLEDGED' && mine) return ['responding', 'status', 'resolve', 'falseAlarm'];
  if (state === 'RESPONDING' && mine) return ['status', 'resolve', 'falseAlarm'];
  if (OWNED.has(state)) return ['falseAlarm'];
  return [];
};
