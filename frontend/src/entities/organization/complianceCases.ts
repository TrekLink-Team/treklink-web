import { useQuery } from '@tanstack/react-query';
import { ApiError, apiClient } from '../../shared/api/apiClient';
import { messageOf } from '../../shared/ui/errors';

// Compliance cases, organizations api-design 28 to 32, and the channel key rotation of 27
// (screen 3.6).

export type ComplianceCaseType =
  | 'SUSPECTED_FRAUD'
  | 'SUSPECTED_THEFT'
  | 'IP_VIOLATION'
  | 'NDA_BREACH'
  | 'OTHER_BREACH';

export type ComplianceCaseStatus = 'OPEN' | 'CLOSED';

export type ComplianceActionKind =
  | 'SUSPEND_ORGANIZATION'
  | 'REVOKE_FIELD_STATION'
  | 'REVOKE_API_KEY'
  | 'OTHER';

export interface ComplianceAction {
  kind: ComplianceActionKind;
  actor: { id: string; fullName: string };
  at: string;
}

export interface ComplianceCase {
  id: string;
  code: string;
  organization: { id: string; code: string };
  type: ComplianceCaseType;
  status: ComplianceCaseStatus;
  evidence: string;
  linkedContractIds: string[];
  linkedLossCases: string[];
  authorityReference: string | null;
  outcome: string | null;
  openedAt: string;
  actions: ComplianceAction[];
}

export interface ComplianceCasePage {
  items: ComplianceCase[];
  pageNumber: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

export const CASE_TYPE_LABEL: Record<ComplianceCaseType, string> = {
  SUSPECTED_FRAUD: 'Suspected fraud',
  SUSPECTED_THEFT: 'Suspected theft',
  IP_VIOLATION: 'IP violation',
  NDA_BREACH: 'NDA breach',
  OTHER_BREACH: 'Other breach',
};

export const ACTION_KIND_LABEL: Record<ComplianceActionKind, string> = {
  SUSPEND_ORGANIZATION: 'Suspend organization',
  REVOKE_FIELD_STATION: 'Revoke Field Station',
  REVOKE_API_KEY: 'Revoke API key',
  OTHER: 'Other action',
};

/** BR-40: these two types need a police report reference to close. */
export const needsPoliceReference = (type: ComplianceCaseType): boolean =>
  type === 'SUSPECTED_FRAUD' || type === 'SUSPECTED_THEFT';

// Query keys of the screen design 3.6.
export const complianceCaseKeys = {
  all: ['compliance-cases'] as const,
  list: (status: ComplianceCaseStatus | undefined, pageNumber: number) =>
    ['compliance-cases', { status, pageNumber }] as const,
  detailAll: ['compliance-case'] as const,
  detail: (id: string) => ['compliance-case', id] as const,
  apiKeys: (organizationId: string) => ['org-api-keys', organizationId] as const,
};

export const COMPLIANCE_PAGE_SIZE = 20;

export const useComplianceCases = (status: ComplianceCaseStatus | undefined, pageNumber: number) =>
  useQuery({
    queryKey: complianceCaseKeys.list(status, pageNumber),
    queryFn: () =>
      apiClient<ComplianceCasePage>(
        `/compliance-cases?pageNumber=${pageNumber}&pageSize=${COMPLIANCE_PAGE_SIZE}${
          status ? `&status=${status}` : ''
        }`,
      ),
  });

export const useComplianceCase = (id: string | undefined) =>
  useQuery({
    queryKey: complianceCaseKeys.detail(id ?? ''),
    queryFn: () => apiClient<ComplianceCase>(`/compliance-cases/${id}`),
    enabled: Boolean(id),
  });

/** A row of organizations api-design 20, the Target of a Revoke API key action. */
export interface OrganizationApiKey {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export const useOrganizationApiKeys = (organizationId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: complianceCaseKeys.apiKeys(organizationId ?? ''),
    queryFn: () =>
      apiClient<{ items: OrganizationApiKey[]; limit: number }>(
        `/organizations/${organizationId}/api-keys`,
      ),
    enabled: enabled && Boolean(organizationId),
    retry: false,
  });

const post = <T>(endpoint: string, body: object): Promise<T> =>
  apiClient<T>(endpoint, { method: 'POST', body: JSON.stringify(body) });

export interface OpenCaseInput {
  type: ComplianceCaseType;
  evidence: string;
  linkedContractIds: string[];
  linkedLossCaseIds: string[];
}

// api-design 29.
export const openComplianceCase = (organizationId: string, input: OpenCaseInput) =>
  post<ComplianceCase>(`/organizations/${organizationId}/compliance-cases`, input);

export interface RecordActionInput {
  kind: ComplianceActionKind;
  targetId: string | null;
  note: string;
}

// api-design 30.
export const recordComplianceAction = (id: string, input: RecordActionInput) =>
  post<ComplianceCase>(`/compliance-cases/${id}/actions`, input);

// api-design 31.
export const closeComplianceCase = (
  id: string,
  input: { outcome: string; authorityReference?: string },
) => post<ComplianceCase>(`/compliance-cases/${id}/close`, input);

// api-design 27: `expectedVersion` is the organization's `version` (SD 3.6 open point 1).
export const rotateChannelKey = (organizationId: string, reason: string, expectedVersion: number) =>
  post<{ id: string; channelKeyVersion: number; channelKeyExposedAt: string | null }>(
    `/organizations/${organizationId}/channel-key/rotate`,
    { reason, expectedVersion },
  );

// NOT_FOUND names the missing record; other 403 and 404 answers read MSG26 (SD 3.6 States).
export const caseErrorText = (failure: unknown): string =>
  failure instanceof ApiError && failure.errorCode === 'NOT_FOUND' ? failure.message : messageOf(failure);
