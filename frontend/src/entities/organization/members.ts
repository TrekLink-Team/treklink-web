import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../shared/api/apiClient';
import type { Member } from './api';

export type MemberRole = Member['role'];

export interface InviteInput {
  email: string;
  fullName: string;
  phoneNumber?: string;
  role: MemberRole;
}

// Screen 3.3 query keys. `['org-members', orgId]` is also the prefix of the counter's list (api.ts),
// so one invalidation refreshes both.
export const memberKeys = {
  all: (organizationId: string) => ['org-members', organizationId] as const,
  list: (organizationId: string, includeDeactivated: boolean) =>
    ['org-members', organizationId, { includeDeactivated }] as const,
};

// organizations api-design 12. The list is not paged: an organization is small (screen 3.3 open point 6).
export const useMemberList = (organizationId: string | undefined, includeDeactivated: boolean, enabled = true) =>
  useQuery({
    queryKey: memberKeys.list(organizationId ?? '', includeDeactivated),
    queryFn: () =>
      apiClient<Member[]>(
        `/organizations/${organizationId}/members${includeDeactivated ? '?includeDeactivated=true' : ''}`,
      ),
    enabled: Boolean(organizationId) && enabled,
  });

const send = <T>(endpoint: string, method: 'POST' | 'PATCH', body: object): Promise<T> =>
  apiClient<T>(endpoint, { method, body: JSON.stringify(body) });

// organizations api-design 13; the server answers "Invitation sent".
export const inviteMember = (organizationId: string, input: InviteInput) =>
  send<Member>(`/organizations/${organizationId}/members`, 'POST', input);

// organizations api-design 14; 409 LAST_MANAGER for the last active Manager.
export const changeMemberRole = (organizationId: string, memberId: string, role: MemberRole) =>
  send<Member>(`/organizations/${organizationId}/members/${memberId}`, 'PATCH', { role });

// organizations api-design 15; 409 LAST_MANAGER for the last active Manager.
export const deactivateMember = (organizationId: string, memberId: string, reason?: string) =>
  send<Member>(
    `/organizations/${organizationId}/members/${memberId}/deactivate`,
    'POST',
    reason ? { reason } : {},
  );

// Resends a pending invitation through auth api-design 05: an account that never set a password is
// sent a new SET_PASSWORD code (D-059 rule 6). The answer is the same inside the resend cooldown,
// where nothing is sent.
export const resendInvitation = (email: string) =>
  send<null>('/auth/password/forgot', 'POST', { email });

// Status text of a member row (screen 3.3 Data).
export const memberStatus = (member: Member): 'Active' | 'Invitation pending' | 'Deactivated' =>
  member.deactivatedAt ? 'Deactivated' : member.invitationPending ? 'Invitation pending' : 'Active';

// Who may stand on the roster: active and with a password set (screen 3.3 open point 4).
export const isRosterEligible = (member: Member): boolean =>
  member.deactivatedAt === null && !member.invitationPending;
