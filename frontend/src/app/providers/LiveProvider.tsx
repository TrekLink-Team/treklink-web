import React, { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '../../entities/session/model';
import { refreshLiveAuth, startLive, stopLive, subscribeLive } from '../../shared/socket/socketClient';

// Keeps one live socket while someone is signed in, and turns stream entries into query invalidations
// (specs/frontend/design.md §3). Position and telemetry entries are applied in place by the map, not
// refetched, so they invalidate nothing here.
export const LiveProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const queryClient = useQueryClient();
  const signedIn = useSession((state) => state.user !== null);

  useEffect(() => {
    if (!signedIn) return;
    startLive(() => useSession.getState().tokens?.accessToken ?? null);
    const stopTokens = useSession.subscribe((state, previous) => {
      const token = state.tokens?.accessToken;
      if (token && token !== previous.tokens?.accessToken) refreshLiveAuth(token);
    });
    const stopMessages = subscribeLive((message) => {
      if (message.kind === 'replay.expired') {
        void queryClient.invalidateQueries({ queryKey: ['map', 'snapshot'] });
      }
      if (message.kind === 'entry' && message.entry.type === 'incident.changed') {
        const incidentId = message.entry.payload.incidentId;
        void queryClient.invalidateQueries({ queryKey: ['incident', incidentId] });
        void queryClient.invalidateQueries({ queryKey: ['incidents'] });
      }
    });
    return () => {
      stopTokens();
      stopMessages();
      stopLive();
    };
  }, [signedIn, queryClient]);

  return <>{children}</>;
};
