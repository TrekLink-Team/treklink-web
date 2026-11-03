import type { Prisma } from '@prisma/client';

// Organization membership of an account (specs/auth/design.md §2). Declared by `auth`, provided by
// `organizations` (task 1.3). The JWT strategy and sign-in read it on every request, so a
// deactivated member or a CLOSED organization takes effect without waiting for the token to expire
// (REQ-EVT-07, REQ-STA-03).
export const ACCOUNT_CONTEXT_PROVIDER = Symbol('ACCOUNT_CONTEXT_PROVIDER');

export type MemberRole = 'MANAGER' | 'OPERATOR';

export interface AccountMembership {
  organizationId: string;
  organizationCode: string;
  legalName: string;
  memberRole: MemberRole;
  organizationStatus: string;
}

// The organization an account belongs to, deactivated member or not (api-design 17).
export interface AccountOrganization {
  id: string;
  name: string;
}

export interface AccountContextProvider {
  // null for a TrekLink account or a deactivated member
  forUser(userId: string): Promise<AccountMembership | null>;
  // Every listed account that has a member row; a TrekLink account is absent from the map.
  organizationsOf(userIds: readonly string[]): Promise<Map<string, AccountOrganization>>;
  // Every account that is or was a member of the organization; empty for an unknown one.
  memberUserIds(organizationId: string): Promise<string[]>;
  // The status of the organization under a FOR SHARE row lock held to the end of the caller's
  // transaction, for a write that must not commit next to a suspension or a closing (D-095 save of the
  // roles of an organization). A status change locks the row FOR UPDATE, so it waits for the caller or
  // the caller waits for it and then reads the new status. Null for an unknown organization.
  lockOrganizationStatus(
    organizationId: string,
    tx: Prisma.TransactionClient,
  ): Promise<string | null>;
}
