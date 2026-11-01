import { useQuery } from '@tanstack/react-query';
import { ApiError, apiClient } from '../../shared/api/apiClient';

// The demo control panel as specs/demo api-design 01 to 04 return it (screen 7.5, D-088). The backend
// serves these routes only when DEMO_CONTROLS_ENABLED is true; otherwise every one answers 404.

export type DemoRole = 'ADMIN' | 'STAFF' | 'ORG_MANAGER' | 'ORG_OPERATOR';

export interface DemoStatus {
  enabled: boolean;
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

export const demoKeys = {
  status: ['demo', 'status'] as const,
  scenarios: ['demo', 'scenarios'] as const,
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
