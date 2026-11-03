import { create } from 'zustand';

// The page context a page gives the device connector (devices design section 11.3). Only the counter
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
  // Puts the connected unit on the contract in place of `row`, then provisions it (design section 11.6).
  swapIn: (connectionId: number, row: CounterRow) => Promise<void>;
}

export type ConnectorContext =
  | CounterContext
  | { kind: 'intake' }
  | { kind: 'device'; deviceId: string }
  | { kind: 'maintenance' }
  | { kind: 'fleet' };

// What an entry point asked for when it opened the connector (REQ-EVT-39).
export interface ConnectorFocus {
  action: 'provision' | 'register' | 'uplink' | 'flash' | 'view';
  assetTag?: string;
  nodeNum?: number | null;
}

interface ConnectorState {
  open: boolean;
  // The connection whose device view shows, or null for the list.
  viewing: number | null;
  focus: ConnectorFocus | null;
  context: ConnectorContext | null;
  // A unit read by the connector that the Register panel takes over (REQ-EVT-31).
  registerFrom: number | null;
  setOpen: (open: boolean) => void;
  view: (connectionId: number | null) => void;
  openFor: (focus: ConnectorFocus) => void;
  setContext: (context: ConnectorContext | null) => void;
  setRegisterFrom: (connectionId: number | null) => void;
}

// Client state of the connector panel (convention 06 §2: Zustand). Nothing here is persisted.
export const useConnectorStore = create<ConnectorState>((set) => ({
  open: false,
  viewing: null,
  focus: null,
  context: null,
  registerFrom: null,
  setOpen: (open) => set(open ? { open } : { open, focus: null, viewing: null }),
  view: (viewing) => set({ viewing }),
  openFor: (focus) => set({ open: true, focus, viewing: null }),
  setContext: (context) => set({ context }),
  setRegisterFrom: (registerFrom) => set({ registerFrom }),
}));
