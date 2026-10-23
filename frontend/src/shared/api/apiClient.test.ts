import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiClient, registerApiAuth, type TokenPair } from './apiClient';

const envelope = (statusCode: number, result: unknown, message = 'OK') =>
  new Response(JSON.stringify({ result, isSuccess: statusCode < 400, statusCode, message }), {
    status: statusCode,
    headers: { 'Content-Type': 'application/json' },
  });

const fresh: TokenPair = {
  accessToken: 'new-access',
  accessTokenExpiresIn: 900,
  refreshToken: 'new-refresh',
  refreshTokenExpiresIn: 1209600,
};

let tokens: { accessToken: string; refreshToken: string } | null;
const onSessionExpired = vi.fn();
const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();

const authOf = (init: RequestInit) => (init.headers as Record<string, string>).Authorization;

beforeEach(() => {
  tokens = { accessToken: 'old-access', refreshToken: 'old-refresh' };
  fetchMock.mockReset();
  onSessionExpired.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  registerApiAuth({
    getTokens: () => tokens,
    onTokens: (next) => {
      tokens = { accessToken: next.accessToken, refreshToken: next.refreshToken };
    },
    onSessionExpired,
  });
});

afterEach(() => {
  registerApiAuth(null);
  vi.unstubAllGlobals();
});

describe('apiClient', () => {
  it('unwraps the envelope and sends the bearer token', async () => {
    fetchMock.mockResolvedValue(envelope(200, { id: 1 }));
    await expect(apiClient('/things')).resolves.toEqual({ id: 1 });
    expect(authOf(fetchMock.mock.calls[0][1])).toBe('Bearer old-access');
  });

  it('throws ApiError with the status, error code and message of a failure envelope', async () => {
    fetchMock.mockResolvedValue(envelope(409, { errorCode: 'CONFLICT_UNIQUE' }, 'email already exists'));
    const failure = await apiClient('/things').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ statusCode: 409, errorCode: 'CONFLICT_UNIQUE', message: 'email already exists' });
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    fetchMock
      .mockResolvedValueOnce(envelope(401, { errorCode: 'UNAUTHORIZED' }, 'Unauthorized'))
      .mockResolvedValueOnce(envelope(200, fresh))
      .mockResolvedValueOnce(envelope(200, { ok: true }));
    await expect(apiClient('/things')).resolves.toEqual({ ok: true });
    expect(fetchMock.mock.calls[1][0]).toMatch(/\/auth\/refresh$/);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({ refreshToken: 'old-refresh' });
    expect(authOf(fetchMock.mock.calls[2][1])).toBe('Bearer new-access');
  });

  it('shares one refresh between concurrent callers', async () => {
    fetchMock.mockImplementation(async (url, init) => {
      if (url.endsWith('/auth/refresh')) return envelope(200, fresh);
      return authOf(init) === 'Bearer new-access' ? envelope(200, { ok: true }) : envelope(401, { errorCode: 'UNAUTHORIZED' }, 'Unauthorized');
    });
    await Promise.all([apiClient('/a'), apiClient('/b'), apiClient('/c')]);
    const refreshes = fetchMock.mock.calls.filter(([url]) => url.endsWith('/auth/refresh'));
    expect(refreshes).toHaveLength(1);
  });

  it('ends the session and reports the 401 when the refresh fails', async () => {
    fetchMock
      .mockResolvedValueOnce(envelope(401, { errorCode: 'UNAUTHORIZED' }, 'Unauthorized'))
      .mockResolvedValueOnce(envelope(401, { errorCode: 'REFRESH_TOKEN_INVALID' }, 'Session expired'));
    await expect(apiClient('/things')).rejects.toMatchObject({ statusCode: 401 });
    expect(onSessionExpired).toHaveBeenCalledOnce();
  });

  it('does not refresh when the sign-in itself is refused', async () => {
    fetchMock.mockResolvedValue(envelope(401, { errorCode: 'INVALID_CREDENTIALS' }, 'Wrong email or password'));
    await expect(apiClient('/auth/login', { method: 'POST' })).rejects.toMatchObject({ statusCode: 401 });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(onSessionExpired).not.toHaveBeenCalled();
  });
});
