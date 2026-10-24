export interface StandardApiResponse<T> {
  result: T | null;
  isSuccess: boolean;
  statusCode: number;
  message: string;
}

export interface TokenPair {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresIn: number;
}

// What the client needs from the session. `shared` cannot import the session entity, so the app layer
// registers these at startup (app/providers/registerApiAuth.ts).
export interface ApiAuthHandlers {
  getTokens: () => { accessToken: string; refreshToken: string } | null;
  onTokens: (tokens: TokenPair) => void;
  onSessionExpired: () => void;
}

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';

// Endpoints whose 401 is an answer, not an expired access token.
const NO_REFRESH = ['/auth/login', '/auth/refresh'];

const FALLBACK_MESSAGE = 'API request failed';
const FALLBACK_CODE = 'UNKNOWN';

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public errorCode: string,
    public message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let handlers: ApiAuthHandlers | null = null;
let refreshing: Promise<string | null> | null = null;

export const registerApiAuth = (next: ApiAuthHandlers | null): void => {
  handlers = next;
  refreshing = null;
};

const normalize = (endpoint: string): string => (endpoint.startsWith('/') ? endpoint : `/${endpoint}`);

// Reads the envelope once. A body that is not JSON (a proxy page, a dropped connection) still
// surfaces as an ApiError.
async function unwrap<T>(response: Response): Promise<T> {
  let body: Partial<StandardApiResponse<T | { errorCode?: string }>> | null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok || !body || !body.isSuccess) {
    const detail = body?.result as { errorCode?: string } | null | undefined;
    throw new ApiError(
      body?.statusCode || response.status,
      detail?.errorCode ?? FALLBACK_CODE,
      body?.message || FALLBACK_MESSAGE,
    );
  }
  return body.result as T;
}

const send = (endpoint: string, options: RequestInit, accessToken: string | null): Promise<Response> =>
  fetch(`${BASE_URL}${normalize(endpoint)}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...options.headers,
    },
  });

// One refresh at a time: a second rotation of the same token revokes the session (D-060 rule 8), so
// concurrent callers share this promise. Resolves to the new access token, or null when the session is over.
const refreshTokens = (): Promise<string | null> => {
  if (refreshing) return refreshing;
  const current = handlers?.getTokens();
  if (!handlers || !current) return Promise.resolve(null);
  const active = handlers;
  refreshing = (async () => {
    try {
      const response = await send(
        '/auth/refresh',
        { method: 'POST', body: JSON.stringify({ refreshToken: current.refreshToken }) },
        null,
      );
      const tokens = await unwrap<TokenPair>(response);
      active.onTokens(tokens);
      return tokens.accessToken;
    } catch (error) {
      // Only a refresh the server answered with 401 (REFRESH_INVALID, REFRESH_REUSED) ends the session.
      // A network failure or a restarting backend leaves the tokens as they are.
      if (error instanceof ApiError && error.statusCode === 401) active.onSessionExpired();
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
};

export async function apiClient<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const sentToken = handlers?.getTokens()?.accessToken ?? null;
  const response = await send(endpoint, options, sentToken);

  if (response.status !== 401 || !handlers || NO_REFRESH.includes(normalize(endpoint))) {
    return unwrap<T>(response);
  }

  // Another caller may already have rotated the tokens; retry with theirs instead of rotating again.
  const latest = handlers.getTokens()?.accessToken ?? null;
  const accessToken = latest && latest !== sentToken ? latest : await refreshTokens();
  if (!accessToken) return unwrap<T>(response);
  return unwrap<T>(await send(endpoint, options, accessToken));
}
