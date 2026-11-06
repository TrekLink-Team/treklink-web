import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { endDockSession, openDockSession, recognizeUnits } from '../../../entities/device/api';
import { DockPresence } from './DockPresence';
import { connectorRegistry, type ConnectorRegistry, type RegistrySnapshot } from './ConnectorRegistry';
import { useConnectorStore, type ConnectorContext, type ConnectorFocus } from './connectorStore';

// The registry of this tab and its live snapshot (devices design section 12.2).
export const useConnector = (): { registry: ConnectorRegistry; snapshot: RegistrySnapshot } => {
  const registry = connectorRegistry(recognizeUnits);
  const snapshot = useSyncExternalStore(registry.subscribe, registry.getSnapshot);
  return { registry, snapshot };
};

// The status refresh of devices design section 12.14 (REQ-EVT-49): the device lists, the named devices and their
// history, and the recognition of every connected unit, with the time kept for the panel and the hub. Pages call
// it after a registration, a provisioning or a quick swap; the panel and the hub call it from Refresh.
export const useConnectorRefresh = () => {
  const queryClient = useQueryClient();
  const setRefreshedAt = useConnectorStore((state) => state.setRefreshedAt);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(
    async (...deviceIds: (string | null | undefined)[]) => {
      setRefreshing(true);
      try {
        void queryClient.invalidateQueries({ queryKey: ['devices'] });
        for (const id of deviceIds) {
          if (!id) continue;
          void queryClient.invalidateQueries({ queryKey: ['device', id] });
          void queryClient.invalidateQueries({ queryKey: ['device-history', id] });
        }
        await connectorRegistry(recognizeUnits).refreshAll();
        setRefreshedAt(new Date());
      } finally {
        setRefreshing(false);
      }
    },
    [queryClient, setRefreshedAt],
  );
  return { refresh, refreshing };
};

// Starts the registry once the Staff shell mounts (REQ-EVT-31): granted ports open without the chooser.
export const useStartConnector = (enabled: boolean): void => {
  useEffect(() => {
    if (!enabled) return undefined;
    const registry = connectorRegistry(recognizeUnits);
    void registry.start();
    return undefined;
  }, [enabled]);
};

// A page tells the connector what it is about (design section 12.3); cleared when the page unmounts.
export const useConnectorContext = (context: ConnectorContext | null): void => {
  const setContext = useConnectorStore((state) => state.setContext);
  useEffect(() => {
    setContext(context);
    return () => setContext(null);
  }, [context, setContext]);
};

// An entry point opens the connector on its unit and action (REQ-EVT-41).
export const openConnector = (focus: ConnectorFocus): void => useConnectorStore.getState().openFor(focus);

// The dock session heartbeat behind the Staff map pin (devices design section 12.8, REQ-EVT-38): Staff
// and Admin only, while the page context is the counter.
export const useDockPresence = (enabled: boolean): void => {
  useEffect(() => {
    if (!enabled) return undefined;
    const registry = connectorRegistry(recognizeUnits);
    const presence = new DockPresence({ open: openDockSession, end: endDockSession });
    const sync = () =>
      presence.sync(registry.getSnapshot(), useConnectorStore.getState().context?.kind === 'counter');
    const offRegistry = registry.subscribe(sync);
    const offStore = useConnectorStore.subscribe(sync);
    const onPageHide = () => presence.stop(true);
    window.addEventListener('pagehide', onPageHide);
    sync();
    return () => {
      offRegistry();
      offStore();
      window.removeEventListener('pagehide', onPageHide);
      presence.stop();
    };
  }, [enabled]);
};
