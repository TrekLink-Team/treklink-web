// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const KEY = 'treklink.session.refresh';

const envelope = (statusCode: number, result: unknown) =>
  new Response(JSON.stringify({ result, isSuccess: statusCode < 400, statusCode, message: 'x' }), {
    status: statusCode,
    headers: { 'Content-Type': 'application/json' },
  });

const rotated = {
  accessToken: 'new-access',
  accessTokenExpiresIn: 900,
  refreshToken: 'new-refresh',
  refreshTokenExpiresIn: 1209600,
};
const user = {
  id: 'u-1',
  email: 'operator@example.invalid',
  fullName: 'Operator',
  accountType: 'ORGANIZATION',
  roles: ['ORG_OPERATOR'],
  organization: null,
};

const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();
const calls = (path: string) => fetchMock.mock.calls.filter(([url]) => url.endsWith(path));

// A fresh page load: the session store reads sessionStorage when its module loads.
const load = async () => {
  vi.resetModules();
  const model = await import('../../entities/session/model');
  const { connectApiToSession } = await import('./registerApiAuth');
  const { restoreSession } = await import('./restoreSession');
  connectApiToSession();
  return { useSession: model.useSession, restoreSession };
};

beforeEach(() => {
  sessionStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('restoreSession (D-090 rule 3)', () => {
  it('signs the user back in after a reload and stores the rotated refresh token', async () => {
    sessionStorage.setItem(KEY, 'old-refresh');
    fetchMock.mockImplementation((url) =>
      Promise.resolve(url.endsWith('/auth/refresh') ? envelope(200, rotated) : envelope(200, user)),
    );
    const { useSession, restoreSession } = await load();
    expect(useSession.getState().restoring).toBe(true);
    await restoreSession();
    expect(useSession.getState()).toMatchObject({ restoring: false, user: { id: 'u-1' } });
    expect(useSession.getState().tokens?.accessToken).toBe('new-access');
    expect(sessionStorage.getItem(KEY)).toBe('new-refresh');
    expect(JSON.parse(calls('/auth/refresh')[0][1].body as string)).toEqual({
      refreshToken: 'old-refresh',
    });
    const meHeaders = calls('/auth/me')[0][1].headers as Record<string, string>;
    expect(meHeaders.Authorization).toBe('Bearer new-access');
  });

  it('rotates the stored token once when restore runs twice, as React StrictMode does', async () => {
    sessionStorage.setItem(KEY, 'old-refresh');
    fetchMock.mockImplementation((url) =>
      Promise.resolve(url.endsWith('/auth/refresh') ? envelope(200, rotated) : envelope(200, user)),
    );
    const { restoreSession } = await load();
    await Promise.all([restoreSession(), restoreSession()]);
    expect(calls('/auth/refresh')).toHaveLength(1);
  });

  it('clears the stored token and stays signed out when the refresh is refused', async () => {
    sessionStorage.setItem(KEY, 'old-refresh');
    fetchMock.mockResolvedValue(envelope(401, { errorCode: 'REFRESH_REUSED' }));
    const { useSession, restoreSession } = await load();
    await restoreSession();
    expect(useSession.getState()).toMatchObject({ restoring: false, user: null, tokens: null });
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(calls('/auth/me')).toHaveLength(0);
  });

  it('keeps the stored token when the network fails, for the next load', async () => {
    sessionStorage.setItem(KEY, 'old-refresh');
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const { useSession, restoreSession } = await load();
    await restoreSession();
    expect(useSession.getState()).toMatchObject({ restoring: false, user: null });
    expect(sessionStorage.getItem(KEY)).toBe('old-refresh');
  });

  it('signs out and clears the stored token when me fails after a good refresh', async () => {
    sessionStorage.setItem(KEY, 'old-refresh');
    fetchMock.mockImplementation((url) =>
      Promise.resolve(
        url.endsWith('/auth/refresh') ? envelope(200, rotated) : envelope(500, { errorCode: 'X' }),
      ),
    );
    const { useSession, restoreSession } = await load();
    await restoreSession();
    expect(useSession.getState()).toMatchObject({ restoring: false, user: null, tokens: null });
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('does nothing without a stored token', async () => {
    const { useSession, restoreSession } = await load();
    expect(useSession.getState().restoring).toBe(false);
    await restoreSession();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stores the refresh token on sign-in and clears it on sign-out', async () => {
    const { useSession } = await load();
    useSession.getState().signIn(rotated, user as never);
    expect(sessionStorage.getItem(KEY)).toBe('new-refresh');
    useSession.getState().signOut(true);
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });
});
