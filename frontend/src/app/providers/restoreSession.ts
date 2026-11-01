import { apiClient, refreshSession } from '../../shared/api/apiClient';
import { useSession, type SessionUser } from '../../entities/session/model';

let restoring: Promise<void> | null = null;

// The silent refresh on load (D-090 rule 3, specs/frontend/tasks.md 1.2). Runs once per page load, so a
// second call (React StrictMode, a second caller) shares the first instead of rotating the stored token
// again, which would revoke the family (D-060 rule 8). A refused refresh signs out and clears the
// storage; a network failure leaves the token for the next load.
export const restoreSession = (): Promise<void> =>
  (restoring ??= (async () => {
    try {
      if (!(await refreshSession())) return;
      const user = await apiClient<SessionUser>('/auth/me');
      const { tokens, signIn } = useSession.getState();
      if (tokens) signIn(tokens, user);
    } catch {
      // `me` failed after a good refresh: the rotated token stays stored and the user signs in again.
    } finally {
      useSession.setState({ restoring: false });
    }
  })());
