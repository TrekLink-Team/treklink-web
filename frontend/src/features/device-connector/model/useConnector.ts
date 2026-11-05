import { useEffect, useSyncExternalStore } from 'react';
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
