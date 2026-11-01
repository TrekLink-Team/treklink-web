import React, { useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useSession } from '../../entities/session/model';
import {
  LIVE_POLL_MS,
  livePolls,
  refreshLiveAuth,
  startLive,
  stopLive,
  subscribeLive,
} from '../../shared/socket/socketClient';

// The stream sends one entry per device and marks no batch, so a bulk check-in or a replay arrives as
// a burst of entries. The list refreshes of one burst are gathered over this window and sent once.
const LIVE_BATCH_MS = 100;

// What the stream entries below would refresh, refetched on a timer in poll mode instead (frontend
// design §3). Only mounted queries refetch.
const POLLED_KEYS = [
  ['map', 'snapshot'],
  ['incidents'],
  ['incident'],
  ['authority-reports'],
  ['contracts'],
  ['contract'],
  ['contract-balance'],
  ['contract-transitions'],
  ['invoices'],
  ['invoice'],
];

type CachedContract = { id?: string; devices?: { deviceId: string }[] } | undefined;
type CachedInvoice = { contract?: { id: string } } | undefined;

// The contracts of a burst of releases: those the entries name (`contractId`, ws-live-contract), plus,
// for an entry stored before the field was added, those whose cached detail holds its device. Null when
// such an entry names no device or a device no cached contract holds, so its contract is unknown.
const contractsReleased = (
  queryClient: QueryClient,
  named: Set<string>,
  deviceIds: Set<string | undefined>,
) => {
  const holding = new Set(named);
  const contracts = queryClient.getQueriesData<CachedContract>({ queryKey: ['contract'] });
  for (const deviceId of deviceIds) {
    if (!deviceId) return null;
    let found = false;
    for (const [, data] of contracts) {
      if (data?.id && data.devices?.some((row) => row.deviceId === deviceId)) {
        holding.add(data.id);
        found = true;
      }
    }
    if (!found) return null;
  }
  return holding;
};

// Keeps one live socket while someone is signed in, and turns stream entries into query invalidations
// (specs/frontend/design.md §3); in poll mode it refetches those views on a timer instead. Position and telemetry entries are applied in place by the map, not
// refetched, so they invalidate nothing here.
export const LiveProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const queryClient = useQueryClient();
  const signedIn = useSession((state) => state.user !== null);

  useEffect(() => {
    if (!signedIn) return;
    // The list keys and released contracts of the current burst, flushed once after LIVE_BATCH_MS.
    // A release without a contract id is kept by its device.
    const lists = new Set<string>();
    const releasedContracts = new Set<string>();
    const released = new Set<string | undefined>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      timer = undefined;
      for (const key of lists) void queryClient.invalidateQueries({ queryKey: [key] });
      if (releasedContracts.size > 0 || released.size > 0) {
        // Only the invoice of a contract that took a device back can gain a late fee line.
        const holding = contractsReleased(queryClient, releasedContracts, released);
        void queryClient.invalidateQueries({
          queryKey: ['invoice'],
          predicate: (query) => {
            const contractId = (query.state.data as CachedInvoice)?.contract?.id;
            return holding === null || !contractId || holding.has(contractId);
          },
        });
      }
      lists.clear();
      releasedContracts.clear();
      released.clear();
    };
    const later = (keys: string[]) => {
      for (const key of keys) lists.add(key);
      timer ??= setTimeout(flush, LIVE_BATCH_MS);
    };

    startLive(() => useSession.getState().tokens?.accessToken ?? null);
    const poll = livePolls()
      ? setInterval(() => {
          for (const queryKey of POLLED_KEYS) void queryClient.invalidateQueries({ queryKey });
        }, LIVE_POLL_MS)
      : undefined;
    const stopTokens = useSession.subscribe((state, previous) => {
      const token = state.tokens?.accessToken;
      if (token && token !== previous.tokens?.accessToken) refreshLiveAuth(token);
    });
    const stopMessages = subscribeLive((message) => {
      if (message.kind === 'replay.expired') {
        void queryClient.invalidateQueries({ queryKey: ['map', 'snapshot'] });
        for (const key of [
          'contract',
          'contracts',
          'contract-balance',
          'contract-transitions',
          'invoices',
          'invoice',
        ]) {
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
          // Label payloads carry no contract id (release payloads now do): refresh only the
          // contract details that hold this device, not every cached contract (review of #144).
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
        if (type === 'device.handedOver') {
          later(['contracts', 'contract-balance', 'contract-transitions']);
        }
        if (type === 'device.released') {
          // A check-in past the grace adds a late fee line (rentals 4.1), which the invoice lists, the
          // invoice of that contract and the dashboard's amount due read (screens 5.6 and 6.1).
          const contractId = message.entry.payload.contractId;
          if (typeof contractId === 'string') releasedContracts.add(contractId);
          else released.add(message.entry.deviceId ?? undefined);
          later(['contracts', 'contract-balance', 'contract-transitions', 'invoices']);
        }
      }
    });
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      if (poll !== undefined) clearInterval(poll);
      stopTokens();
      stopMessages();
      stopLive();
    };
  }, [signedIn, queryClient]);

  return <>{children}</>;
};
