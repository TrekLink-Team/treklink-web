import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../shared/api/apiClient';

// The position and telemetry history of one device as monitoring api-design 03 returns it (screen 9.2).
export type HistoryKind = 'POSITION' | 'TELEMETRY';
export const HISTORY_KINDS: readonly HistoryKind[] = ['POSITION', 'TELEMETRY'];

export interface HistoryPoint {
  at: string;
  kind: HistoryKind;
  lat: number | null;
  lon: number | null;
  altitude: number | null;
  batteryPct: number | null;
}

export interface History {
  deviceId: string;
  // The organization's rental periods that overlap the range; empty for TrekLink Staff and Admin.
  clippedTo: { from: string; to: string | null }[];
  points: HistoryPoint[];
  // The range held more than 50,000 points and only the oldest are answered.
  truncated: boolean;
}

// A range as ISO 8601 UTC instants, `from` inclusive and `to` exclusive, and the kinds asked for.
export interface HistoryRange {
  from: string;
  to: string;
  kinds: readonly HistoryKind[];
}

// The default of the parameter `monitoring.historyMaxRangeDays` (configuration matrix: 7, from 1 to 31).
// The backend checks the range against the live parameter (monitoring api-design 03, REQ-ERR-02), but
// no read gives the parameter to the roles of this page: GET /api/parameters needs `parameter.manage`
// (Admin only) and the history response carries no limit. So the form checks this default, and the
// server's 400 is the backstop when an Admin changes the parameter.
export const DEFAULT_HISTORY_MAX_RANGE_DAYS = 7;

const DAY_MS = 86_400_000;

// MSG35: the period is reversed or longer than the limit. Returns the message, or null when it is fine.
export const periodError = (from: string, to: string): string | null => {
  const span = new Date(to).getTime() - new Date(from).getTime();
  return Number.isFinite(span) && span > 0 && span <= DEFAULT_HISTORY_MAX_RANGE_DAYS * DAY_MS
    ? null
    : `Choose an end after the start, at most ${DEFAULT_HISTORY_MAX_RANGE_DAYS} days later.`;
};

export const historyKeys = {
  range: (deviceId: string, range: HistoryRange) =>
    ['telemetry-history', deviceId, range.from, range.to, range.kinds.join(',')] as const,
};

// Both kinds send no `kind`; one kind sends it.
const queryOf = (range: HistoryRange, format?: 'csv'): string => {
  const query = new URLSearchParams({ from: range.from, to: range.to });
  if (range.kinds.length === 1) query.set('kind', range.kinds[0]);
  if (format) query.set('format', format);
  return `?${query.toString()}`;
};

const pathOf = (deviceId: string) => `/telemetry/devices/${deviceId}/history`;

export const fetchHistory = (deviceId: string, range: HistoryRange) =>
  apiClient<History>(`${pathOf(deviceId)}${queryOf(range)}`);

// `format=csv` answers the CSV text in the envelope's `result`; a capped range ends with `# truncated`.
export const fetchHistoryCsv = (deviceId: string, range: HistoryRange) =>
  apiClient<string>(`${pathOf(deviceId)}${queryOf(range, 'csv')}`);

// A fixed past range does not change while the screen is open, so no refetch on focus and no retry of
// a refusal (screen 9.2: stale time 60 seconds, no live data).
export const useHistory = (deviceId: string, range: HistoryRange) =>
  useQuery({
    queryKey: historyKeys.range(deviceId, range),
    queryFn: () => fetchHistory(deviceId, range),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
