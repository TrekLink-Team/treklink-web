import { useQuery } from '@tanstack/react-query';
import { ApiError, apiClient } from '../../shared/api/apiClient';
import { queryString, type Page } from '../../shared/api/query';
import { messageOf } from '../../shared/ui/errors';
import type { StatusEntry } from '../../shared/ui/status';

// Loss cases, devices api-design 17 to 22 and 27 (screen 4.4, UC-49, UC-60, D-045).

export type LossCaseState = 'REPORTED' | 'SEARCHING' | 'RECOVERED' | 'CONFIRMED' | 'SETTLED';
export type LossCustody = 'RENTER' | 'TREKLINK';
export type LossDecision = 'CHARGED' | 'REDUCED' | 'WAIVED' | 'WRITTEN_OFF';

export interface LossCase {
  id: string;
  code: string;
  device: { id: string; assetTag: string };
  state: LossCaseState;
  stateFromDevice: string;
  reportedAt: string;
  description: string;
  lastSeenAt: string | null;
  lastPosition: { lat: number; lon: number } | null;
  custody: LossCustody | null;
  contractDeviceId: string | null;
  organization: { id: string; code: string } | null;
  keyExposed: boolean;
  suspectedTheft: boolean;
  policeReference: string | null;
  searchEndsAt: string | null;
  triagedById: string | null;
  decision: LossDecision | null;
  chargeVnd: number | null;
  version: number;
}

export const LOSS_CASE_STATE: Record<LossCaseState, StatusEntry> = {
  REPORTED: { label: 'Reported', tone: 'critical' },
  SEARCHING: { label: 'Searching', tone: 'attention' },
  CONFIRMED: { label: 'Confirmed lost', tone: 'waiting' },
  RECOVERED: { label: 'Recovered', tone: 'done' },
  SETTLED: { label: 'Settled', tone: 'ended' },
};

export const LOSS_CASE_STATES = Object.keys(LOSS_CASE_STATE) as LossCaseState[];

export const CUSTODY_LABEL: Record<LossCustody, string> = {
  RENTER: 'Renter',
  TREKLINK: 'TrekLink',
};

export const DECISION_LABEL: Record<LossDecision, string> = {
  CHARGED: 'Charged',
  REDUCED: 'Reduced',
  WAIVED: 'Waived',
  WRITTEN_OFF: 'Written off',
};

export type LossScope = 't' | 'o';

// Query keys of screen 4.4: `['loss-cases', scope, filters]` and `['loss-case', id]`.
export const lossCaseKeys = {
  all: ['loss-cases'] as const,
  list: (scope: LossScope, state: LossCaseState | undefined, pageNumber: number) =>
    ['loss-cases', scope, { state, pageNumber }] as const,
  detail: (id: string) => ['loss-case', id] as const,
};

export const LOSS_PAGE_SIZE = 20;

export const useLossCases = (scope: LossScope, state: LossCaseState | undefined, pageNumber: number) =>
  useQuery({
    queryKey: lossCaseKeys.list(scope, state, pageNumber),
    queryFn: () =>
      apiClient<Page<LossCase>>(
        `/loss-cases${queryString({ state, pageNumber, pageSize: LOSS_PAGE_SIZE })}`,
      ),
  });

export const useLossCase = (id: string | undefined) =>
  useQuery({
    queryKey: lossCaseKeys.detail(id ?? ''),
    queryFn: () => apiClient<LossCase>(`/loss-cases/${id}`),
    enabled: Boolean(id),
  });

const post = <T>(endpoint: string, body: object): Promise<T> =>
  apiClient<T>(endpoint, { method: 'POST', body: JSON.stringify(body) });

// api-design 17.
export const reportLoss = (deviceId: string, description: string) =>
  post<LossCase>(`/devices/${deviceId}/loss-cases`, { description });

// api-design 19.
export const triageLossCase = (
  item: LossCase,
  input: { suspectedTheft: boolean; policeReference: string | null },
) => post<LossCase>(`/loss-cases/${item.id}/triage`, { ...input, expectedVersion: item.version });

// api-design 20.
export const recoverLossCase = (item: LossCase, note: string) =>
  post<LossCase>(`/loss-cases/${item.id}/recover`, { note, expectedVersion: item.version });

// api-design 21.
export const confirmLossCase = (item: LossCase) =>
  post<LossCase>(`/loss-cases/${item.id}/confirm`, { expectedVersion: item.version });

// api-design 22.
export const decideLossCase = (
  item: LossCase,
  input: { decision: LossDecision; chargeVnd: number | null; reason: string | null },
) => post<LossCase>(`/loss-cases/${item.id}/decision`, { ...input, expectedVersion: item.version });

export const MSG36 = 'Someone else changed this. Reload to see the latest.';

// The screen 4.4 States table: STALE_VERSION is MSG36, a state refusal (MSG28), the open case
// (MSG29) and the separation of duty (MSG30) carry the server's message; 403 and 404 read MSG26.
export const lossErrorText = (failure: unknown): string => {
  if (failure instanceof ApiError) {
    if (failure.errorCode === 'STALE_VERSION') return MSG36;
    if (
      failure.errorCode === 'INVALID_STATE_TRANSITION' ||
      failure.errorCode === 'LOSS_CASE_OPEN' ||
      failure.errorCode === 'SEPARATION_OF_DUTY' ||
      failure.errorCode === 'VALIDATION_FAILED'
    ) {
      return failure.message;
    }
  }
  return messageOf(failure);
};

export const isStale = (failure: unknown) =>
  failure instanceof ApiError && failure.errorCode === 'STALE_VERSION';
