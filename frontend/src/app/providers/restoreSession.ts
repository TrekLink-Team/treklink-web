import { apiClient, refreshSession } from '../../shared/api/apiClient';
import { useSession, type SessionUser } from '../../entities/session/model';

let restoring: Promise<void> | null = null;

// The silent refresh on load (D-090 rule 3, specs/frontend/tasks.md 1.2). Runs once per page load, so a
// second call (React StrictMode, a second caller) shares the first instead of rotating the stored token
// again, which would revoke the family (D-060 rule 8). A refused refresh, or a failed `me` after a good
// one, signs out and clears the storage; a network failure on the refresh leaves the token for the next
// load.
export const restoreSession = (): Promise<void> =>
  (restoring ??= (async () => {
    try {
      if (!(await refreshSession())) return;
      const user = await apiClient<SessionUser>('/auth/me');
      const { tokens, signIn } = useSession.getState();
      if (tokens) signIn(tokens, user);
    } catch {
      // `me` failed after a good refresh: end the half-restored session (clearing the stored token) so
      // the store never holds tokens without a user; the user signs in again.
      useSession.getState().signOut();
    } finally {
      useSession.setState({ restoring: false });
    }
  })());
