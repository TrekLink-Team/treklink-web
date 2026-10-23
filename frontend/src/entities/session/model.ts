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
  signIn: (tokens: SessionTokens, user: SessionUser) => void;
  setTokens: (tokens: SessionTokens) => void;
  signOut: () => void;
}

// Held in memory only. The auth context and silent refresh of `frontend` tasks 1.1 and 1.2 build on
// this store; nothing is written to localStorage.
export const useSession = create<SessionState>((set) => ({
  tokens: null,
  user: null,
  signIn: (tokens, user) => set({ tokens, user }),
  setTokens: (tokens) => set({ tokens }),
  signOut: () => set({ tokens: null, user: null }),
}));

// A path on this origin: one leading slash, not followed by another slash or a backslash, which
// browsers read as `//` and so as another host.
const SAME_ORIGIN_PATH = /^\/(?![/\\])/;

// Where a user lands after sign-in (specs/frontend/design.md §2, D-059 rule 1): a same-origin `next`
// path wins; otherwise the Org Manager lands on `/o/contracts` until the `/o` dashboard (task 5.6)
// exists, the Org Operator on `/o/map`, TrekLink Staff and Admin on `/t/map`.
export const landingRoute = (next: string | null, user: SessionUser): string => {
  if (next && SAME_ORIGIN_PATH.test(next)) return next;
  if (user.accountType === 'TREKLINK') return '/t/map';
  return user.organization?.memberRole === 'MANAGER' ? '/o/contracts' : '/o/map';
};
