import type { AccountItem, AccountRole } from './api';

export const ROLE_OPTIONS: { value: AccountRole; label: string }[] = [
  { value: 'STAFF', label: 'Staff' },
  { value: 'ADMIN', label: 'Admin' },
];

export const isAdmin = (account: Pick<AccountItem, 'roles'>): boolean =>
  account.roles.includes('ADMIN');

// The role the form edits: the Admin role wins when an account holds both.
export const roleOf = (account: Pick<AccountItem, 'roles'>): AccountRole =>
  isAdmin(account) ? 'ADMIN' : 'STAFF';

export const roleLabel = (role: AccountRole): string => (role === 'ADMIN' ? 'Admin' : 'Staff');

// The only active Admin, from the active accounts of the platform, or undefined when there are several
// or the list is not complete. The server (LAST_ADMIN) stays the backstop.
export const lastActiveAdminId = (
  active: { items: AccountItem[]; totalPages: number } | undefined,
): string | undefined => {
  if (!active || active.totalPages > 1) return undefined;
  const admins = active.items.filter(isAdmin);
  return admins.length === 1 ? admins[0].id : undefined;
};

// A phone number as the DTO accepts it (auth.dto.ts): digits and spaces, a leading plus allowed.
const PHONE = /^\+?[0-9 ]{8,20}$/;
export const phoneError = (value: string): string | undefined =>
  value.trim() === '' || PHONE.test(value.trim())
    ? undefined
    : 'Enter 8 to 20 digits, with a leading + if needed.';

// The invitation is pending while an active account has never signed in (D-057 rule 1).
export const invitationPending = (account: AccountItem): boolean =>
  account.isActive && account.lastLoginAt === null;
