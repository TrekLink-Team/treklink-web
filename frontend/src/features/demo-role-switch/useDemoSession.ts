import { useNavigate } from 'react-router-dom';
import type { DemoSession } from '../../entities/demo/api';
import { landingRoute, useSession } from '../../entities/session/model';

// Replaces the window's session with one the demo backend issued (a role switch, or the Admin session
// after a stage). The AuthProvider clears every cached query when the account changes.
export const useAdoptDemoSession = () => {
  const signIn = useSession((state) => state.signIn);
  const navigate = useNavigate();
  return (session: DemoSession, options: { stay?: boolean } = {}) => {
    const { user, ...tokens } = session;
    signIn(tokens, user);
    if (!options.stay) navigate(landingRoute(null, user), { replace: true });
  };
};
