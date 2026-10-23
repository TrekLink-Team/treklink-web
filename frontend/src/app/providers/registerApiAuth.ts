import { useSession } from '../../entities/session/model';
import { registerApiAuth } from '../../shared/api/apiClient';

// Connects the API client to the in-memory session. A refresh that fails ends the session, and the
// route guards then send the user to sign-in (specs/frontend/tasks.md 1.2).
export const connectApiToSession = (): void =>
  registerApiAuth({
    getTokens: () => {
      const { tokens } = useSession.getState();
      return tokens && { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
    },
    onTokens: (tokens) => useSession.getState().setTokens(tokens),
    onSessionExpired: () => useSession.getState().signOut(),
  });
