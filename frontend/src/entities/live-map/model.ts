import type { LiveEntry } from '../../shared/socket/socketClient';
import type { IncidentState } from '../../shared/ui/status';
import type { MapSnapshot, SnapshotDevice } from './api';

// The live map's in-memory state (screen 9.1): the snapshot, then every stream entry after its cursor
// applied in `seq` order (monitoring ws-live-contract). Pure functions, so the page and the tests
// fold the same entries the same way.
export interface LiveMapState {
  cursor: number;
  devices: Record<string, SnapshotDevice>;
  /** Device ids in snapshot order, so the side panel does not reshuffle as entries arrive. */
  order: string[];
}

const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null);

// The later of two ISO instants; null counts as never.
const latest = (a: string | null, b: string | null): string | null =>
  a === null ? b : b === null ? a : a > b ? a : b;

export const fromSnapshot = (snapshot: MapSnapshot): LiveMapState => ({
  cursor: snapshot.cursor,
  devices: Object.fromEntries(snapshot.devices.map((device) => [device.id, device])),
  order: snapshot.devices.map((device) => device.id),
});

const withDevice = (
  state: LiveMapState,
  seq: number,
  id: string,
  change: (device: SnapshotDevice) => SnapshotDevice,
): LiveMapState => {
  const device = state.devices[id];
  if (!device) return { ...state, cursor: seq };
  return { ...state, cursor: seq, devices: { ...state.devices, [id]: change(device) } };
};

/**
 * Applies one stream entry. An entry at or below the cursor is already in the state and changes
 * nothing. An entry about a device the map does not list only moves the cursor; `device.handedOver`
 * is how a new device arrives, and the page answers it by reloading the snapshot. A `late` position
 * or telemetry is never drawn as live (REQ-EVT-04).
 */
export const applyEntry = (state: LiveMapState, entry: LiveEntry): LiveMapState => {
  if (entry.seq <= state.cursor) return state;
  const { payload, seq } = entry;
  const id = entry.deviceId ?? '';
  switch (entry.type) {
    case 'device.position': {
      const lat = asNumber(payload.lat);
      const lon = asNumber(payload.lon);
      const at = asString(payload.at);
      if (payload.late === true || lat === null || lon === null || at === null)
        return { ...state, cursor: seq };
      return withDevice(state, seq, id, (device) =>
        device.position && device.position.at > at
          ? device
          : {
              ...device,
              position: { lat, lon, at },
              lastSeenAt: latest(device.lastSeenAt, at),
              stale: false,
            },
      );
    }
    case 'device.telemetry': {
      const at = asString(payload.at);
      if (payload.late === true || at === null) return { ...state, cursor: seq };
      return withDevice(state, seq, id, (device) => ({
        ...device,
        batteryPct: asNumber(payload.batteryPct) ?? device.batteryPct,
        lastSeenAt: latest(device.lastSeenAt, at),
        stale: false,
      }));
    }
    case 'device.stale':
      return withDevice(state, seq, id, (device) => ({
        ...device,
        stale: payload.stale === true,
        lastSeenAt: latest(device.lastSeenAt, asString(payload.lastSeenAt)),
      }));
    case 'device.label': {
      const holder = payload.holder as { name?: unknown } | null | undefined;
      const name = asString(holder?.name);
      return withDevice(state, seq, id, (device) => ({
        ...device,
        holder: name === null ? null : { name },
      }));
    }
    case 'device.released': {
      if (!state.devices[id]) return { ...state, cursor: seq };
      const devices = { ...state.devices };
      delete devices[id];
      return { cursor: seq, devices, order: state.order.filter((other) => other !== id) };
    }
    // The entry names the incident's device (`deviceId`). One stored before the field was added names
    // none and only moves the cursor here; `useLiveMap` reloads the snapshot for it.
    case 'incident.changed': {
      const incidentId = asString(payload.incidentId);
      const incidentState = asString(payload.state) as IncidentState | null;
      if (incidentId === null || incidentState === null) return { ...state, cursor: seq };
      return withDevice(state, seq, id, (device) => {
        if (incidentState === 'CLOSED')
          return device.openIncident?.id === incidentId
            ? { ...device, openIncident: null }
            : device;
        // `code` joins the payload with monitoring 2.1's enrichment; until then the known code stays.
        const code =
          asString(payload.code) ??
          (device.openIncident?.id === incidentId ? device.openIncident.code : null);
        return { ...device, openIncident: { id: incidentId, code, state: incidentState } };
      });
    }
    default:
      return { ...state, cursor: seq };
  }
};

/** Rebuilds the state from a snapshot and the entries received around it, in `seq` order. */
export const rebuild = (snapshot: MapSnapshot, entries: readonly LiveEntry[]): LiveMapState =>
  [...entries].sort((a, b) => a.seq - b.seq).reduce(applyEntry, fromSnapshot(snapshot));

/**
 * Stale on the map: the server or the sweep said so, or nothing was heard for longer than
 * `staleAfterSeconds` of GET /api/map/config (FR-MON-03). A device never heard is not stale; it has
 * no position yet.
 */
export const isStale = (device: SnapshotDevice, now: number, staleAfterSeconds: number): boolean =>
  device.stale ||
  (device.lastSeenAt !== null && now - Date.parse(device.lastSeenAt) > staleAfterSeconds * 1000);
