import { describe, expect, it } from 'vitest';
import type { AccountItem } from './api';
import { invitationPending, lastActiveAdminId, phoneError, roleOf } from './model';

const account = (overrides: Partial<AccountItem> = {}): AccountItem => ({
  id: 'a-1',
  email: 'a@treklink.vn',
  fullName: 'A',
  phoneNumber: null,
  accountType: 'TREKLINK',
  roles: ['STAFF'],
  isActive: true,
  lastLoginAt: '2026-10-20T03:15:00.000Z',
  createdAt: '2026-10-01T03:15:00.000Z',
  ...overrides,
});

describe('the TrekLink account model (screen 7.1)', () => {
  it('reads the Admin role first when an account holds both', () => {
    expect(roleOf(account({ roles: ['STAFF', 'ADMIN'] }))).toBe('ADMIN');
    expect(roleOf(account())).toBe('STAFF');
  });

  it('finds the last active Admin only from a complete list with exactly one Admin', () => {
    const admin = account({ id: 'a-2', roles: ['ADMIN'] });
    expect(lastActiveAdminId({ items: [account(), admin], totalPages: 1 })).toBe('a-2');
    expect(
      lastActiveAdminId({
        items: [admin, account({ id: 'a-3', roles: ['ADMIN'] })],
        totalPages: 1,
      }),
    ).toBeUndefined();
    expect(lastActiveAdminId({ items: [admin], totalPages: 2 })).toBeUndefined();
    expect(lastActiveAdminId(undefined)).toBeUndefined();
  });

  it('accepts the phone numbers the DTO accepts and names the rest', () => {
    expect(phoneError('')).toBeUndefined();
    expect(phoneError('+84 901 234 567')).toBeUndefined();
    expect(phoneError('0901234567')).toBeUndefined();
    expect(phoneError('12ab')).toBe('Enter 8 to 20 digits, with a leading + if needed.');
  });

  it('calls an active account that never signed in invitation pending', () => {
    expect(invitationPending(account({ lastLoginAt: null }))).toBe(true);
    expect(invitationPending(account({ lastLoginAt: null, isActive: false }))).toBe(false);
    expect(invitationPending(account())).toBe(false);
  });
});
