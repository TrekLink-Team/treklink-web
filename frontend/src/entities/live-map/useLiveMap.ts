import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { isLivePaused, subscribeLive, type LiveEntry } from '../../shared/socket/socketClient';
import { useMapSnapshot } from './api';
import { rebuild, type LiveMapState } from './model';

// Entries kept to rebuild the state when a snapshot arrives or reloads. A snapshot is at most a few
// seconds behind the stream, so the newest entries are enough; older ones are below its cursor.
const KEPT_ENTRIES = 2000;

// Every stream entry that can change the map; personal alerts are the global banner's.
const isMapEntry = (entry: LiveEntry) => entry.type !== 'incident.alert';

/**
 * The live map of screen 9.1: GET /api/map/snapshot, then the stream entries after its cursor.
 * It listens from mount, before the snapshot answers, so an entry committed while the snapshot is
 * read is kept and applied once the snapshot's cursor is known (entries at or below it are dropped).
 * `device.handedOver` reloads the snapshot, which is how a newly rented device appears.
 */
export const useLiveMap = (organizationId: string | null) => {
  const queryClient = useQueryClient();
  const snapshot = useMapSnapshot(organizationId);
  const [entries, setEntries] = useState<LiveEntry[]>([]);
  const [paused, setPaused] = useState(isLivePaused());

  useEffect(
    () =>
      subscribeLive((message) => {
        if (message.kind === 'paused') setPaused(message.paused);
        if (message.kind !== 'entry' || !isMapEntry(message.entry)) return;
        const entry = message.entry;
        setEntries((kept) => [...kept.slice(-(KEPT_ENTRIES - 1)), entry]);
        if (entry.type === 'device.handedOver')
          void queryClient.invalidateQueries({ queryKey: ['map', 'snapshot'] });
      }),
    [queryClient],
  );

  const state: LiveMapState | null = useMemo(
    () => (snapshot.data ? rebuild(snapshot.data, entries) : null),
    [snapshot.data, entries],
  );

  return { snapshot, state, paused };
};
