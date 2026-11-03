import { useEffect, useSyncExternalStore } from 'react';
import { recognizeUnits } from '../../../entities/device/api';
import { connectorRegistry, type ConnectorRegistry, type RegistrySnapshot } from './ConnectorRegistry';
import { useConnectorStore, type ConnectorContext, type ConnectorFocus } from './connectorStore';

// The registry of this tab and its live snapshot (devices design section 11.2).
export const useConnector = (): { registry: ConnectorRegistry; snapshot: RegistrySnapshot } => {
  const registry = connectorRegistry(recognizeUnits);
  const snapshot = useSyncExternalStore(registry.subscribe, registry.getSnapshot);
  return { registry, snapshot };
};

// Starts the registry once the Staff shell mounts (REQ-EVT-29): granted ports open without the chooser.
export const useStartConnector = (enabled: boolean): void => {
  useEffect(() => {
    if (!enabled) return undefined;
    const registry = connectorRegistry(recognizeUnits);
    void registry.start();
    return undefined;
  }, [enabled]);
};

// A page tells the connector what it is about (design section 11.3); cleared when the page unmounts.
export const useConnectorContext = (context: ConnectorContext | null): void => {
  const setContext = useConnectorStore((state) => state.setContext);
  useEffect(() => {
    setContext(context);
    return () => setContext(null);
  }, [context, setContext]);
};

// An entry point opens the connector on its unit and action (REQ-EVT-39).
export const openConnector = (focus: ConnectorFocus): void => useConnectorStore.getState().openFor(focus);
