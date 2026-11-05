import type { LiveEntry } from '../../shared/socket/socketClient';
import type { IncidentState } from '../../shared/ui/status';
import type { MapSnapshot, SnapshotDevice, UnitState } from './api';

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
              state: 'LIVE',
              counterLocation: null,
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
        state: 'LIVE',
        counterLocation: null,
      }));
    }
    // A stale entry whose reading predates the unit's handover (the fleet map receives those) leaves
    // the unit not heard since handover (D-092 rule 2); any other entry sets offline or live.
    case 'device.stale':
      return withDevice(state, seq, id, (device) => {
        const lastSeenAt = asString(payload.lastSeenAt);
        if (lastSeenAt !== null && device.handedOverAt !== null && lastSeenAt < device.handedOverAt)
          return device;
        const stale = payload.stale === true;
        return {
          ...device,
          stale,
          state: stale ? 'OFFLINE' : 'LIVE',
          counterLocation: null,
          lastSeenAt: latest(device.lastSeenAt, lastSeenAt),
        };
      });
    case 'device.label': {
      const holder = payload.holder as { name?: unknown } | null | undefined;
      const name = asString(holder?.name);
      return withDevice(state, seq, id, (device) => ({
        ...device,
        holder: name === null ? null : { name },
      }));
    }
    // A unit held at the counter (devices design section 12.8): the Staff map pins it there while the
    // session is open. A docked unit the map does not list yet comes with the snapshot (`needsSnapshot`).
    case 'device.docked': {
      const since = asString(payload.since);
      const counter = payload.counterLocation as { name?: unknown; lat?: unknown; lon?: unknown } | null;
      const name = asString(counter?.name);
      const lat = asNumber(counter?.lat);
      const lon = asNumber(counter?.lon);
      return withDevice(state, seq, id, (device) => ({
        ...device,
        docked: since === null ? device.docked : { since, byName: asString(payload.byName) },
        counterLocation: name !== null && lat !== null && lon !== null ? { name, lat, lon } : device.counterLocation,
      }));
    }
    case 'device.undocked': {
      const device = state.devices[id];
      if (!device) return { ...state, cursor: seq };
      if (device.state === 'DOCKED') {
        const devices = { ...state.devices };
        delete devices[id];
        return { cursor: seq, devices, order: state.order.filter((other) => other !== id) };
      }
      return withDevice(state, seq, id, (current) => ({
        ...current,
        docked: null,
        counterLocation: current.state === 'NOT_HEARD' ? current.counterLocation : null,
      }));
    }
    case 'device.released': {
      if (!state.devices[id]) return { ...state, cursor: seq };
      const devices = { ...state.devices };
      delete devices[id];
      return { cursor: seq, devices, order: state.order.filter((other) => other !== id) };
    }
    // The entry names the incident's device (`deviceId`). One stored before the field was added names
    // none and only moves the cursor here. `useLiveMap` reloads the snapshot for it, and for an
    // incident the marker does not hold yet when the entry carries no `code`, as one stored before
    // monitoring 2.1's enrichment does (`needsSnapshot`).
    case 'incident.changed': {
      const incidentId = asString(payload.incidentId);
      const incidentState = asString(payload.state) as IncidentState | null;
      if (incidentId === null || incidentState === null) return { ...state, cursor: seq };
      return withDevice(state, seq, id, (device) => {
        if (incidentState === 'CLOSED')
          return device.openIncident?.id === incidentId
            ? { ...device, openIncident: null }
            : device;
        // The payload carries `code` since monitoring 2.1's enrichment; an older entry keeps the known code.
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

/**
 * Whether a stream entry needs the snapshot read again. `device.handedOver` brings a device the map
 * does not list. An `incident.changed` with no device id (stored before the field was added) cannot
 * be placed on a marker. One for an incident its marker does not hold yet, a new SOS, is placed from
 * the entry, and its `code` comes with it since monitoring 2.1's enrichment, so the panel shows "Open
 * incident INC-..." without a read; an entry with no `code` (stored before the enrichment, or sent when
 * the server could not read the incident) still reads the snapshot again (demo MF-04 step 1).
 */
export const needsSnapshot = (state: LiveMapState | null, entry: LiveEntry): boolean => {
  if (entry.type === 'device.handedOver') return true;
  if (entry.type === 'device.docked') return state === null || !entry.deviceId || !state.devices[entry.deviceId];
  if (entry.type !== 'incident.changed') return false;
  if (!entry.deviceId || state === null) return true;
  const incidentId = asString(entry.payload.incidentId);
  if (incidentId === null || entry.payload.state === 'CLOSED') return false;
  if (asString(entry.payload.code) !== null) return false;
  return state.devices[entry.deviceId]?.openIncident?.id !== incidentId;
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

/**
 * The state a unit is drawn in now: not heard since handover until something is heard during its
 * custody interval, then offline while stale (`isStale`) and live otherwise (monitoring REQ-UBI-04).
 */
export const unitStateOf = (
  device: SnapshotDevice,
  now: number,
  staleAfterSeconds: number | undefined,
): UnitState => {
  if (device.state === 'NOT_HEARD') return 'NOT_HEARD';
  if (device.state === 'DOCKED') return 'DOCKED';
  const stale =
    staleAfterSeconds === undefined ? device.stale : isStale(device, now, staleAfterSeconds);
  return stale ? 'OFFLINE' : 'LIVE';
};

const RANK: Record<UnitState, number> = { LIVE: 0, OFFLINE: 1, NOT_HEARD: 2, DOCKED: 3 };

/** Live units first, then offline, then not heard since handover, then docked at the counter; each group
 *  keeps its order. */
export const byUnitState = <T extends { state: UnitState }>(rows: readonly T[]): T[] =>
  rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => RANK[a.row.state] - RANK[b.row.state] || a.index - b.index)
    .map(({ row }) => row);
