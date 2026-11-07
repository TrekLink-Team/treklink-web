import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiClient } from '../../shared/api/apiClient';

// The demo control panel as specs/demo api-design 01 to 04 return it (screen 7.5, D-088). The backend
// serves controls only with DEMO_CONTROLS_ENABLED and explicit VITE_APP_ENV sandbox/staging.

export type DemoRole = 'ADMIN' | 'STAFF' | 'ORG_MANAGER' | 'ORG_OPERATOR';

export interface DemoStatus {
  enabled: boolean;
  quickEnabled?: boolean;
  roleSwitchEnabled?: boolean;
  databaseLocal: boolean;
  lastStaged: { scenarioId: string; at: string } | null;
}

export interface DemoScenario {
  id: string;
  title: string;
  flow: string;
  summary: string;
  available: boolean;
  unavailableReason: string | null;
}

export interface StagedRecord {
  label: string;
  code: string;
  path: string;
}

// The token pair and account the backend issues, the same shape as the sign-in response.
export interface DemoSession {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresIn: number;
  user: {
    id: string;
    email: string;
    fullName: string;
    accountType: 'TREKLINK' | 'ORGANIZATION';
    roles: string[];
    organization: {
      id: string;
      code: string;
      legalName: string;
      status: string;
      memberRole: 'MANAGER' | 'OPERATOR';
    } | null;
  };
}

export interface StageResult {
  scenarioId: string;
  stagedAt: string;
  records: StagedRecord[];
  firstSteps: string[];
  session: DemoSession;
}

export const DEMO_ROLES: { role: DemoRole; label: string }[] = [
  { role: 'ADMIN', label: 'Admin' },
  { role: 'STAFF', label: 'Staff' },
  { role: 'ORG_MANAGER', label: 'Manager' },
  { role: 'ORG_OPERATOR', label: 'Operator' },
];

// One sandbox test account (specs/demo api-design 05, D-089): fictitious demo data, password included.
export interface DemoTestAccount {
  role: DemoRole;
  roleLabel: string;
  email: string;
  password: string;
  fullName: string;
  organization: string | null;
}

export const demoKeys = {
  status: ['demo', 'status'] as const,
  scenarios: ['demo', 'scenarios'] as const,
  accounts: ['demo', 'accounts'] as const,
};

// Demo mode off: the route is a 404, read as "no demo controls" rather than an error.
export const fetchDemoStatus = async (): Promise<DemoStatus | null> => {
  try {
    return await apiClient<DemoStatus>('/demo/status');
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 404) return null;
    throw error;
  }
};

export const useDemoStatus = (signedIn = true) =>
  useQuery({
    queryKey: demoKeys.status,
    queryFn: fetchDemoStatus,
    enabled: signedIn,
    retry: false,
    staleTime: 60_000,
  });

export const fetchDemoScenarios = () => apiClient<DemoScenario[]>('/demo/scenarios');

export const useDemoScenarios = (enabled: boolean) =>
  useQuery({
    queryKey: demoKeys.scenarios,
    queryFn: fetchDemoScenarios,
    enabled,
    retry: false,
  });

// Public, and routed only while DEMO_TEST_ACCOUNTS_ENABLED is true: any failure, a 404 included, means
// "no box" to the caller, so the query never retries.
export const fetchDemoAccounts = async (): Promise<DemoTestAccount[]> =>
  (await apiClient<{ accounts: DemoTestAccount[] }>('/demo/accounts')).accounts;

export const useDemoAccounts = () =>
  useQuery({
    queryKey: demoKeys.accounts,
    queryFn: fetchDemoAccounts,
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

export const stageScenario = (id: string) =>
  apiClient<StageResult>(`/demo/scenarios/${encodeURIComponent(id)}/stage`, { method: 'POST' });

export const switchDemoRole = (role: DemoRole) =>
  apiClient<DemoSession>('/demo/switch-role', { method: 'POST', body: JSON.stringify({ role }) });

// Screen 7.5 shows the server's message for the demo refusals (DEMO_DISABLED, DEMO_DATABASE_NOT_LOCAL,
// DEMO_BUSY, DEMO_SCENARIO_UNAVAILABLE, DEMO_SEED_NOT_CONFIGURED) and for a missing seeded account;
// every other failure reads as anywhere else (MSG26 for 403 and 404).
export const demoMessageOf = (error: unknown, fallback: (error: unknown) => string): string => {
  if (error instanceof ApiError) {
    if (error.errorCode.startsWith('DEMO_')) return error.message;
    if (error.statusCode === 404 && /seeded account/i.test(error.message)) return error.message;
  }
  return fallback(error);
};

export interface QuickOptions {
  organizations: { id: string; code: string; legalName: string }[];
  variants: { id: string; code: string }[];
  units: {
    deviceId: string;
    assetTag: string;
    contractId: string;
    contractCode: string;
    nodeNum: number | null;
  }[];
  contracts: { id: string; code: string; version: number }[];
  incidents: { id: string; code: string; state: string; version: number }[];
  profile: { active: boolean; version: number };
  minimumQuantity: number;
}
export type QuickAction =
  | 'organization'
  | 'contract'
  | 'incident'
  | 'loss'
  | 'fault'
  | 'walkers'
  | 'profile'
  | 'term-end'
  | 'next-tier';
export interface QuickInput {
  organizationId?: string;
  hardwareVariantId?: string;
  quantity?: number;
  target?: 'REQUESTED' | 'APPROVED' | 'ACTIVE' | 'RETURN_DUE';
  deviceId?: string;
  recordId?: string;
  expectedVersion?: number;
  active?: boolean;
}
export interface QuickResult {
  runId: number;
  label: string;
  records: StagedRecord[];
  error: string | null;
  errorCode: string | null;
}
export const useDemoQuickOptions = (enabled: boolean) =>
  useQuery({
    queryKey: ['demo', 'quick'],
    queryFn: () => apiClient<QuickOptions>('/demo/quick'),
    enabled,
    retry: false,
  });
export const useRunDemoQuick = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ action, input }: { action: QuickAction; input: QuickInput }) =>
      apiClient<QuickResult>(`/demo/quick/${action}`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSettled: () => {
      // A scenario can change inventory, organizations, billing and live views together.
      void client.invalidateQueries();
    },
  });
};

// W43b errors retain the committed run links without treating the action as successful.
export const quickResultOf = (failure: unknown): QuickResult | null => {
  if (!(failure instanceof ApiError)) return null;
  const detail = failure.resultDetails;
  if (
    !detail ||
    typeof detail.runId !== 'number' ||
    typeof detail.label !== 'string' ||
    !Array.isArray(detail.records)
  )
    return null;
  const records: StagedRecord[] = [];
  for (const value of detail.records as unknown[]) {
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    if (
      typeof record.label !== 'string' ||
      typeof record.code !== 'string' ||
      typeof record.path !== 'string'
    )
      return null;
    records.push({ label: record.label, code: record.code, path: record.path });
  }
  return {
    runId: detail.runId,
    label: detail.label,
    records,
    error: failure.message,
    errorCode: failure.errorCode,
  };
};
