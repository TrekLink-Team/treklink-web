// Organization membership of an account (specs/auth/design.md §2). Declared by `auth`, provided by
// `organizations` (task 2.9). The JWT strategy and sign-in read it on every request, so a
// deactivated member or a CLOSED organization takes effect without waiting for the token to expire
// (REQ-EVT-07, REQ-STA-03).
export const ACCOUNT_CONTEXT_PROVIDER = Symbol('ACCOUNT_CONTEXT_PROVIDER');

export type MemberRole = 'MANAGER' | 'OPERATOR';

export interface AccountMembership {
  organizationId: string;
  memberRole: MemberRole;
  organizationStatus: string;
}

export interface AccountContextProvider {
  // null for a TrekLink account or a deactivated member
  forUser(userId: string): Promise<AccountMembership | null>;
}
