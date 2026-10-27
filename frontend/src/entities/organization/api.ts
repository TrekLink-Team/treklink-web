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

export const organizationKeys = {
  detail: (id: string) => ['organization', id] as const,
  members: (id: string) => ['org-members', id] as const,
};

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
