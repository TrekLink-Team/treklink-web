import { create } from 'zustand';

// The signed-in account as GET /api/auth/me and the login response return it (auth api-design 01, 04).
export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  accountType: 'TREKLINK' | 'ORGANIZATION';
  roles: string[];
  organization: {
    id: string;
    code: string;
    legalName: string;
    status: string;
    memberRole: 'MANAGER' | 'OPERATOR';
  } | null;
}

export interface SessionTokens {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresIn: number;
}

// The refresh token is kept in the tab's sessionStorage so a reload keeps the session (D-090 rule 3,
// amending D-060 rule 3): written on sign-in and on every rotation, removed on sign-out and on a refused
// refresh, and gone when the tab closes. The access token stays in memory. Storage can be unavailable
// (private mode, a sandboxed frame); the session then lasts until the reload, as before.
const REFRESH_KEY = 'treklink.session.refresh';

export const storedRefreshToken = (): string | null => {
  try {
    return sessionStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
};

const storeRefreshToken = (token: string | null): void => {
  try {
    if (token) sessionStorage.setItem(REFRESH_KEY, token);
    else sessionStorage.removeItem(REFRESH_KEY);
  } catch {
    // Without storage the session simply does not survive a reload.
  }
};

interface SessionState {
  tokens: SessionTokens | null;
  user: SessionUser | null;
  // True from start-up until the stored refresh token has been tried (app/providers/restoreSession.ts),
  // so the route guards do not send a returning user to sign-in first.
  restoring: boolean;
  // True after Sign out in the account menu, which navigates to sign-in itself; false when the
  // session expired, so the route guard keeps `?next=` for the page the user was on.
  signedOutByUser: boolean;
  signIn: (tokens: SessionTokens, user: SessionUser) => void;
  setTokens: (tokens: SessionTokens) => void;
  signOut: (byUser?: boolean) => void;
}

// Held in memory, with the refresh token mirrored to sessionStorage (above). The auth context and silent
// refresh of `frontend` tasks 1.1 and 1.2 build on this store; nothing is written to localStorage.
export const useSession = create<SessionState>((set) => ({
  tokens: null,
  user: null,
  restoring: storedRefreshToken() !== null,
  signedOutByUser: false,
  signIn: (tokens, user) => {
    storeRefreshToken(tokens.refreshToken);
    set({ tokens, user, signedOutByUser: false, restoring: false });
  },
  setTokens: (tokens) => {
    storeRefreshToken(tokens.refreshToken);
    set({ tokens });
  },
  signOut: (byUser = false) => {
    storeRefreshToken(null);
    set({ tokens: null, user: null, signedOutByUser: byUser, restoring: false });
  },
}));

// `next` as a path on this origin, or null. The browser's own URL parser resolves it, so the check
// cannot drift from how the browser reads `//host`, `/\host` or `/<tab>/host`, which all leave the
// origin.
const sameOriginPath = (next: string, origin: string): string | null => {
  if (!next.startsWith('/')) return null;
  try {
    const url = new URL(next, origin);
    return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : null;
  } catch {
    return null;
  }
};

// Where a user lands after sign-in (specs/frontend/design.md §2, D-059 rule 1): a same-origin `next`
// path wins; otherwise the Org Manager lands on `/o/contracts` until the `/o` dashboard (task 5.6)
// exists, the Org Operator on `/o/map`, TrekLink Staff and Admin on `/t/map`.
export const landingRoute = (
  next: string | null,
  user: SessionUser,
  origin: string = window.location.origin,
): string => {
  const path = next ? sameOriginPath(next, origin) : null;
  if (path) return path;
  if (user.accountType === 'TREKLINK') return '/t/map';
  return user.organization?.memberRole === 'MANAGER' ? '/o' : '/o/map';
};
