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

interface SessionState {
  tokens: SessionTokens | null;
  user: SessionUser | null;
  // True after Sign out in the account menu, which navigates to sign-in itself; false when the
  // session expired, so the route guard keeps `?next=` for the page the user was on.
  signedOutByUser: boolean;
  signIn: (tokens: SessionTokens, user: SessionUser) => void;
  setTokens: (tokens: SessionTokens) => void;
  signOut: (byUser?: boolean) => void;
}

// Held in memory only. The auth context and silent refresh of `frontend` tasks 1.1 and 1.2 build on
// this store; nothing is written to localStorage.
export const useSession = create<SessionState>((set) => ({
  tokens: null,
  user: null,
  signedOutByUser: false,
  signIn: (tokens, user) => set({ tokens, user, signedOutByUser: false }),
  setTokens: (tokens) => set({ tokens }),
  signOut: (byUser = false) => set({ tokens: null, user: null, signedOutByUser: byUser }),
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
