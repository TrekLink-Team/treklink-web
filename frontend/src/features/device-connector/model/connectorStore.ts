import type React from 'react';
import { create } from 'zustand';
import type { ConnectionState } from './ConnectorRegistry';

// The page context a page gives the device connector (devices design section 12.3). Only the counter
// carries data: the contract and its reserved rows, so the panel can offer provisioning and the quick
// swap. The counter page passes its actions too, so a row in the panel runs the same flow as the
// counter row.
export interface CounterRow {
  deviceId: string;
  assetTag: string;
  nodeNum: number | null;
  provisionedKeyVersion: number | null;
}

export interface CounterContext {
  kind: 'counter';
  contractId: string;
  contractCode: string;
  status: string;
  variantCode: string;
  version: number;
  keyVersion: number | null;
  rows: CounterRow[];
  // Provisions the reserved row whose unit is the connection (design section 8.4).
  provision: (connectionId: number, row: CounterRow) => Promise<void>;
  // Puts the connected unit on the contract in place of `row`, then provisions it (design section 12.6).
  // Answers the server's refusal when the exchange itself was refused, so the swap dialog shows it and
  // stays open (screen 4.6); null once the exchange went through, whatever the provisioning did.
  swapIn: (connectionId: number, row: CounterRow) => Promise<string | null>;
}

export type ConnectorContext =
  | CounterContext
  | { kind: 'intake' }
  | { kind: 'device'; deviceId: string }
  | { kind: 'maintenance' }
  | { kind: 'fleet' };

// What an entry point asked for when it opened the connector (REQ-EVT-41).
export interface ConnectorFocus {
  action: 'provision' | 'register' | 'uplink' | 'flash' | 'view';
  assetTag?: string;
  nodeNum?: number | null;
}

// The firmware flash panel of devices design section 9.2 (task 8.3) plugs into the hub here: the hub
// shows Update firmware disabled with its reason until a panel registers, then opens the panel with the
// unit and a way to borrow its port under the hub's one write lock (REQ-EVT-43, REQ-UBI-09).
export interface FlashPanelProps {
  device: {
    id: string;
    assetTag: string;
    nodeNum: number;
    variantCode: string;
    // The OPEN FIRMWARE_UPDATE record, if any: the flash no longer needs one (design section 12.14).
    maintenanceRecordId: string | null;
    reportedFirmware?: string | null;
    firmwareOnRecord?: string | null;
  };
  // The asset tag typed for a RESERVED or RENTED unit, sent with the start of the flash record (api-design 33).
  confirmAssetTag?: string;
  // After a verified write; the hub reads the unit again.
  onFlashed?: (version: string) => void;
  // Runs the flash on the unit's port; the hub reads the unit again afterwards (design section 12.7).
  withPort: <T>(
    work: (port: SerialPort, stage: (state: ConnectionState) => void) => Promise<T>,
  ) => Promise<T>;
  onClose: () => void;
}

export type FlashPanel = React.ComponentType<FlashPanelProps>;

interface ConnectorState {
  open: boolean;
  // The connection whose device view shows, or null for the list.
  viewing: number | null;
  focus: ConnectorFocus | null;
  context: ConnectorContext | null;
  // A unit read by the connector that the Register panel takes over (REQ-EVT-33).
  registerFrom: number | null;
  flashPanel: FlashPanel | null;
  // The connection the device hub page shows (devices design section 12.13), kept in memory only: no
  // node number goes into the address bar (REQ-UBI-08).
  hubUnit: number | null;
  // When the connected units were last asked about (Refresh, REQ-EVT-49), shown by the panel and the hub.
  refreshedAt: Date | null;
  setRefreshedAt: (at: Date) => void;
  // An action a card asked the hub to start on its unit (design section 12.14): the hub opens on the unit and runs
  // it through its own dialogs, so a typed confirmation is never skipped.
  hubIntent: { connectionId: number; action: 'reboot' | 'flash' } | null;
  openHub: (connectionId: number, action?: 'reboot' | 'flash') => void;
  clearHubIntent: () => void;
  setOpen: (open: boolean) => void;
  view: (connectionId: number | null) => void;
  openFor: (focus: ConnectorFocus) => void;
  setContext: (context: ConnectorContext | null) => void;
  setRegisterFrom: (connectionId: number | null) => void;
  // Task 8.3 calls this once with its panel; null unregisters it.
  registerFlashPanel: (panel: FlashPanel | null) => void;
  clearFocus: () => void;
  showInHub: (connectionId: number | null) => void;
}

// Client state of the connector panel (convention 06 §2: Zustand). Nothing here is persisted.
export const useConnectorStore = create<ConnectorState>((set) => ({
  open: false,
  viewing: null,
  focus: null,
  context: null,
  registerFrom: null,
  flashPanel: null,
  hubUnit: null,
  refreshedAt: null,
  setRefreshedAt: (refreshedAt) => set({ refreshedAt }),
  hubIntent: null,
  openHub: (connectionId, action) =>
    set({ hubUnit: connectionId, hubIntent: action ? { connectionId, action } : null, open: false, focus: null, viewing: null }),
  clearHubIntent: () => set({ hubIntent: null }),
  setOpen: (open) => set(open ? { open } : { open, focus: null, viewing: null }),
  view: (viewing) => set({ viewing }),
  openFor: (focus) => set({ open: true, focus, viewing: null }),
  setContext: (context) => set({ context }),
  setRegisterFrom: (registerFrom) => set({ registerFrom }),
  registerFlashPanel: (flashPanel) => set({ flashPanel }),
  clearFocus: () => set({ focus: null }),
  showInHub: (hubUnit) => set({ hubUnit }),
}));
