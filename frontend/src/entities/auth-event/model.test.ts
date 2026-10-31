import { describe, expect, it } from 'vitest';
import { SECURITY_SIGNALS, filterErrors, filtersOf, hasFilters, paramsOf } from './model';

const ID = '3f2e1d0c-9b8a-4c7d-8e6f-5a4b3c2d1e0f';

describe('the sign-in event filters in the URL (screen 7.3)', () => {
  it('reads the filters and drops an unknown event type or an empty value', () => {
    expect(
      filtersOf(
        new URLSearchParams(`userId=${ID}&type=LOGIN_FAILED&from=2026-10-01T00:00:00.000Z`),
      ),
    ).toEqual({
      userId: ID,
      type: 'LOGIN_FAILED',
      from: '2026-10-01T00:00:00.000Z',
    });
    expect(filtersOf(new URLSearchParams('type=NOPE&organizationId=%20'))).toEqual({});
  });

  it('writes only the set filters, in a fixed order', () => {
    expect(paramsOf({ type: 'LOGOUT', userId: ID }).toString()).toBe(`userId=${ID}&type=LOGOUT`);
    expect(hasFilters({})).toBe(false);
    expect(hasFilters({ type: 'LOGOUT' })).toBe(true);
  });

  it('blocks a malformed account id and an end that is not after the start', () => {
    expect(filterErrors({ userId: 'x' })).toEqual({ userId: 'Account id must be a UUID.' });
    expect(
      filterErrors({ from: '2026-10-02T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' }),
    ).toEqual({
      to: 'Choose an end after the start.',
    });
    expect(
      filterErrors({
        userId: ID,
        from: '2026-10-01T00:00:00.000Z',
        to: '2026-10-02T00:00:00.000Z',
      }),
    ).toEqual({});
  });

  it('marks token reuse and an account lock as the security signals', () => {
    expect([...SECURITY_SIGNALS].sort()).toEqual(['ACCOUNT_LOCKED', 'TOKEN_REUSE_DETECTED']);
  });
});
