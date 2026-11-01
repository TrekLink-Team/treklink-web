import { storedRefreshToken, useSession } from '../../entities/session/model';
import { registerApiAuth } from '../../shared/api/apiClient';

// Connects the API client to the session. A refresh that fails ends the session, and the route guards
// then send the user to sign-in (specs/frontend/tasks.md 1.2). Before a reload's restore has run, the
// session holds no tokens and the stored refresh token stands in, with no access token (D-090 rule 3).
export const connectApiToSession = (): void =>
  registerApiAuth({
    getTokens: () => {
      const { tokens } = useSession.getState();
      if (tokens) return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
      const refreshToken = storedRefreshToken();
      return refreshToken ? { accessToken: '', refreshToken } : null;
    },
    onTokens: (tokens) => useSession.getState().setTokens(tokens),
    onSessionExpired: () => useSession.getState().signOut(),
  });
