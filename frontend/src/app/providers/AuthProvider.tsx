import React, { useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '../../entities/session/model';
import { AuthContext } from './useAuth';

// Holds the `me` response of the session store for the tree. The query cache is cleared in the same
// tick as the session changes hands, so a render after sign-in or sign-out never reads the previous
// account's cached data (specs/frontend/tasks.md 1.1, NFR-SEC-03).
export const AuthProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const queryClient = useQueryClient();
  const user = useSession((state) => state.user);
  const signOut = useSession((state) => state.signOut);

  useEffect(
    () =>
      useSession.subscribe((state, previous) => {
        if (state.user?.id !== previous.user?.id) queryClient.clear();
      }),
    [queryClient],
  );

  const value = useMemo(() => ({ user, signOut }), [user, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
