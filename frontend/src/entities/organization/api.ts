import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../shared/api/apiClient';

// The head of organizations api-design 03: what the counter handover needs (screen 5.4).
export interface OrganizationSummary {
  id: string;
  code: string;
  legalName: string;
  status: string;
  statusChangedAt: string;
  channelKeyVersion: number;
  // Not returned by api-design 03 today (SD 3.6 open point 1); the exposure notice shows only when present.
  channelKeyExposedAt?: string | null;
  version: number;
}

// organizations api-design 12.
export interface Member {
  id: string;
  userId: string;
  email: string | null;
  fullName: string | null;
  role: 'MANAGER' | 'OPERATOR';
  invitationPending: boolean;
  deactivatedAt: string | null;
}

export type OrganizationStatus = 'PENDING' | 'ACTIVE' | 'REJECTED' | 'SUSPENDED' | 'CLOSED';

// A row of organizations api-design 02, with the verification and decision of 05 to 07.
export interface OrganizationReview {
  id: string;
  code: string;
  legalName: string;
  taxCode: string;
  address: string;
  contactEmail: string;
  contactPhone: string;
  status: OrganizationStatus;
  statusChangedAt: string;
  verifiedAt: string | null;
  verificationMethod: 'IN_PERSON' | 'PHONE' | null;
  documentsSeen: string[];
  masterContractRef: string | null;
  ndaSigned: boolean;
  softwareLicenceSigned: boolean;
  decidedAt: string | null;
  rejectionReason: string | null;
  version: number;
  createdAt: string;
}

export interface RegistrationInput {
  legalName: string;
  taxCode: string;
  address: string;
  contactPhone: string;
  managerFullName: string;
  managerEmail: string;
  managerPhone: string;
}

export interface VerificationInput {
  method: 'IN_PERSON' | 'PHONE';
  documentsSeen: string[];
  masterContractRef: string;
  ndaSigned: boolean;
  softwareLicenceSigned: boolean;
  expectedVersion: number;
}

export const organizationKeys = {
  all: ['organizations'] as const,
  list: (status: OrganizationStatus | undefined) => ['organizations', status ?? 'ALL'] as const,
  detail: (id: string) => ['organization', id] as const,
  members: (id: string) => ['org-members', id] as const,
};

const post = <T>(endpoint: string, body: object): Promise<T> =>
  apiClient<T>(endpoint, { method: 'POST', body: JSON.stringify(body) });

// organizations api-design 01, public (MSG04 on success).
export const registerOrganization = (input: RegistrationInput) =>
  post<{ organizationId: string; code: string; status: OrganizationStatus }>(
    '/organizations/register',
    input,
  );

// organizations api-design 05 to 07.
export const verifyOrganization = (id: string, input: VerificationInput) =>
  post<OrganizationReview>(`/organizations/${id}/verification`, input);

export const approveOrganization = (id: string, expectedVersion: number) =>
  post<OrganizationReview>(`/organizations/${id}/approve`, { expectedVersion });

export const rejectOrganization = (id: string, reason: string, expectedVersion: number) =>
  post<OrganizationReview>(`/organizations/${id}/reject`, { reason, expectedVersion });

// organizations api-design 02, the Staff and Admin queue.
export const useOrganizations = (status: OrganizationStatus | undefined) =>
  useQuery({
    queryKey: organizationKeys.list(status),
    queryFn: () =>
      apiClient<{ items: OrganizationReview[]; totalCount: number }>(
        `/organizations?pageSize=100${status ? `&status=${status}` : ''}`,
      ),
  });

export const useOrganization = (id: string | undefined) =>
  useQuery({
    queryKey: organizationKeys.detail(id ?? ''),
    queryFn: () => apiClient<OrganizationSummary>(`/organizations/${id}`),
    enabled: Boolean(id),
  });

export const useMembers = (id: string | undefined) =>
  useQuery({
    queryKey: organizationKeys.members(id ?? ''),
    queryFn: () => apiClient<Member[]>(`/organizations/${id}/members`),
    enabled: Boolean(id),
  });
