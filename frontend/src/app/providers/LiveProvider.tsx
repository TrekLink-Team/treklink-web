import React, { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '../../entities/session/model';
import {
  refreshLiveAuth,
  startLive,
  stopLive,
  subscribeLive,
} from '../../shared/socket/socketClient';

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
        for (const key of ['contract', 'contracts', 'contract-balance', 'contract-transitions']) {
          void queryClient.invalidateQueries({ queryKey: [key] });
        }
      }
      if (message.kind === 'entry' && message.entry.type === 'incident.changed') {
        const incidentId = message.entry.payload.incidentId;
        void queryClient.invalidateQueries({ queryKey: ['incident', incidentId] });
        void queryClient.invalidateQueries({ queryKey: ['incidents'] });
        // Screen 8.3: the report list follows the incident; reports have no event of their own.
        void queryClient.invalidateQueries({ queryKey: ['authority-reports'] });
      }
      if (message.kind === 'entry') {
        const type = message.entry.type;
        if (type === 'device.handedOver') {
          // The payload names the contract. Matching on it also refreshes a contract whose cached
          // devices do not hold this device yet, as after a replacement handover (rentals 4.3).
          const contractId = message.entry.payload.contractId;
          void queryClient.invalidateQueries({
            queryKey: typeof contractId === 'string' ? ['contract', contractId] : ['contract'],
          });
        }
        if (type === 'device.label' || type === 'device.released') {
          // Label and release payloads carry no contract id: refresh only the contract details that
          // hold this device, not every cached contract (review of #144).
          const deviceId = message.entry.deviceId;
          void queryClient.invalidateQueries({
            queryKey: ['contract'],
            predicate: (query) => {
              const data = query.state.data as { devices?: { deviceId: string }[] } | undefined;
              return (
                !deviceId || !data?.devices || data.devices.some((row) => row.deviceId === deviceId)
              );
            },
          });
        }
        if (type === 'device.handedOver' || type === 'device.released') {
          for (const key of ['contracts', 'contract-balance', 'contract-transitions']) {
            void queryClient.invalidateQueries({ queryKey: [key] });
          }
        }
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
