import { AccountType } from '@prisma/client';
import { SessionUser } from '../account-session.service';
import { Account } from '../accounts.repository';

// Shared builders for the auth unit tests.
export const anAccount = (overrides: Partial<Account> = {}): Account => ({
  id: 'user-1',
  email: 'staff@treklink.vn',
  fullName: 'Tran Thi B',
  accountType: AccountType.TREKLINK,
  isActive: true,
  deletedAt: null,
  passwordHash: '$2b$04$hash',
  lockedUntil: null,
  lastLoginAt: null,
  roles: ['STAFF'],
  ...overrides,
});

export const aSessionUser = (overrides: Partial<SessionUser> = {}): SessionUser => ({
  id: 'user-1',
  email: 'staff@treklink.vn',
  fullName: 'Tran Thi B',
  accountType: AccountType.TREKLINK,
  roles: ['STAFF'],
  organization: null,
  ...overrides,
});

export const CLIENT = { ip: '10.0.0.1', userAgent: 'jest' };
