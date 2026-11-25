import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { apiClient } from '../../shared/api/apiClient';
import type { StagedRecord } from './api';

// The demo panel of specs/demo api-design 13 to 16 (D-110). It needs no account: every request carries the
// panel password in X-Demo-Panel-Password. The password lives only in this module for the life of the
// tab (ui-panel.md): never in storage, a cookie or the URL, so a reload or a closed tab forgets it.

let password: string | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

export const panelPassword = {
  get: () => password,
  set: (value: string) => {
    password = value;
    notify();
  },
  clear: () => {
    password = null;
    notify();
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export const usePanelPassword = () =>
  useSyncExternalStore(panelPassword.subscribe, panelPassword.get, panelPassword.get);

export type PanelActionId =
  | 'incident-sos'
  | 'incident-acknowledge'
  | 'incident-respond'
  | 'incident-resolve'
  | 'incident-false-alarm'
  | 'incident-close'
  | 'contract-create'
  | 'contract-approve'
  | 'contract-handover'
  | 'contract-return'
  | 'contract-close'
  | 'contract-cancel'
  | 'invoice-pay'
  | 'device-maintenance-open'
  | 'device-maintenance-complete';

export type PanelGroup = 'Incidents' | 'Contracts' | 'Billing' | 'Devices';

export interface PanelActionView {
  id: PanelActionId;
  group: PanelGroup;
  label: string;
  needs: ('recordId' | 'expectedVersion' | 'deviceId')[];
}

export interface PanelIncident {
  id: string;
  code: string;
  state: string;
  version: number;
  organizationId: string | null;
  deviceId: string;
  simulated: boolean;
}
export interface PanelContract {
  id: string;
  code: string;
  status: string;
  version: number;
  organizationId: string;
}
export interface PanelInvoice {
  id: string;
  number: string;
  contractId: string;
  dueVnd: string | number;
}
export interface PanelDevice {
  id: string;
  assetTag: string;
  status: string;
  version: number;
  nodeNum: number;
}

export const PLAYBACK_FLOWS = ['MF-01a', 'MF-01b', 'MF-01c', 'MF-02', 'MF-03', 'MF-04', 'MF-05'] as const;
export type PlaybackFlow = (typeof PLAYBACK_FLOWS)[number];
export type PlaybackStatus = 'IDLE' | 'RUNNING' | 'PAUSED' | 'DONE' | 'FAILED' | 'STOPPED';

export interface PlaybackStep {
  title: string;
  window: string;
  screen: string;
  line: string;
  click: string;
  // WAITING: a person does this step on a real screen the panel never acts on (the Admin approval,
  // D-110 clarification); `prompt` says what to do.
  status: 'PENDING' | 'RUNNING' | 'WAITING' | 'DONE' | 'FAILED';
  prompt: string | null;
  error: string | null;
  records: StagedRecord[];
}

export interface PlaybackState {
  flow: PlaybackFlow | null;
  status: PlaybackStatus;
  index: number;
  intervalSeconds: number;
  nextAt: string | null;
  steps: PlaybackStep[];
  error: string | null;
}

export interface PanelOverview {
  writable: boolean;
  actions: PanelActionView[];
  options: {
    incidents: PanelIncident[];
    contracts: PanelContract[];
    invoices: PanelInvoice[];
    devices: PanelDevice[];
    organizations: { id: string; code: string; legalName: string }[];
    variants: { id: string; code: string; name: string }[];
  };
  playback: PlaybackState;
  reset: { available: boolean; reason: string | null; nextAllowedAt: string | null };
}

export interface PanelActionInput {
  recordId?: string;
  expectedVersion?: number;
  deviceId?: string;
}

export interface PanelActionResult {
  action: PanelActionId;
  runId: number;
  label: string;
  actedAs: { role: string; email: string | null } | null;
  records: StagedRecord[];
}

export interface PanelResetResult {
  resetAt: string;
  tables: number;
  seedGroups: number;
}

export type PlaybackCommand = 'START' | 'PAUSE' | 'RESUME' | 'STEP' | 'STOP';

// Every call names the password explicitly, so a request can never go out with a stale one.
const panelRequest = <T>(endpoint: string, secret: string, init: RequestInit = {}) =>
  apiClient<T>(endpoint, {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), 'X-Demo-Panel-Password': secret },
  });

export const fetchPanel = (secret: string) => panelRequest<PanelOverview>('/demo/panel', secret);

export const runPanelAction = (secret: string, action: PanelActionId, input: PanelActionInput) =>
  panelRequest<PanelActionResult>(`/demo/panel/actions/${encodeURIComponent(action)}`, secret, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const sendPlayback = (
  secret: string,
  body: { command: PlaybackCommand; flow?: PlaybackFlow; intervalSeconds?: number },
) =>
  panelRequest<PlaybackState>('/demo/panel/playback', secret, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const resetDemoData = (secret: string, confirmation: string) =>
  panelRequest<PanelResetResult>('/demo/panel/reset', secret, {
    method: 'POST',
    body: JSON.stringify({ confirmation }),
  });

export const panelKeys = { overview: ['demo', 'panel'] as const };

// While the page is open and unlocked it reads route 13 every 5 s, so playback progress and new records
// show without a click (ui-panel.md, live data).
export const PANEL_POLL_MS = 5000;

export const useDemoPanel = (secret: string | null) =>
  useQuery({
    queryKey: panelKeys.overview,
    queryFn: () => fetchPanel(secret!),
    enabled: secret !== null,
    refetchInterval: PANEL_POLL_MS,
    retry: false,
    gcTime: 0,
  });

export const usePanelMutation = <I, R>(run: (secret: string, input: I) => Promise<R>) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: I) => {
      const secret = panelPassword.get();
      if (!secret) throw new Error('Enter the panel password.');
      return run(secret, input);
    },
    onSettled: () => client.invalidateQueries({ queryKey: panelKeys.overview }),
  });
};
