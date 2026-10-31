import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../shared/api/apiClient';
import { AUTH_EVENT_TYPES, authEventKeys, fetchAuthEvents } from './api';

vi.mock('../../shared/api/apiClient', () => ({ apiClient: vi.fn() }));

describe('the authentication log read (auth api-design 17)', () => {
  beforeEach(() => vi.mocked(apiClient).mockReset());

  it('sends only the filters that are set, with the page and 20 to a page', async () => {
    await fetchAuthEvents({ type: 'LOGIN_FAILED', organizationId: 'o-1' }, 2);
    expect(vi.mocked(apiClient).mock.calls[0][0]).toBe(
      '/auth-events?type=LOGIN_FAILED&organizationId=o-1&pageNumber=2&pageSize=20',
    );
  });

  it('keys a query by its filters and its page, and lists the 11 event types', () => {
    expect(authEventKeys.list({ type: 'LOGOUT' }, 3)).toEqual([
      'auth-events',
      { type: 'LOGOUT' },
      3,
    ]);
    expect(AUTH_EVENT_TYPES).toHaveLength(11);
  });
});
