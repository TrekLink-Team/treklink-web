import type { DeviceProjection } from '../devices';

// The state of a rented unit from its custody interval (REQ-UBI-04, D-092 rule 2): heard since the
// handover and within `monitoring.deviceStaleSeconds`, heard since the handover and silent longer, or not
// heard since the handover.
export type UnitState = 'LIVE' | 'OFFLINE' | 'NOT_HEARD';

// What a reader may see of one unit's last readings, in wire form.
export interface CustodyView {
  state: UnitState;
  // True for `OFFLINE` only.
  stale: boolean;
  position: { lat: number; lon: number; at: string } | null;
  lastSeenAt: string | null;
  batteryPct: number | null;
}

export type CustodyReadings = Pick<
  DeviceProjection,
  'lastSeenAt' | 'lastLatitude' | 'lastLongitude' | 'lastPositionAt' | 'batteryPct' | 'lastBatteryAt'
>;

// The one custody rule of the map snapshot (api-design 02) and the organization API (api-design 04), so
// both answer the same for the same unit at the same time (monitoring design §4). `clipped` is an
// organization's own view: no position, last-seen time or battery from before the handover (D-040).
// TrekLink staff keep the stored values with the same states. `staleBefore` is the epoch milliseconds
// before which a reading is older than `monitoring.deviceStaleSeconds`. Pure: the caller reads the
// projection, the handover time and the parameter.
export const custodyView = (
  device: CustodyReadings,
  handedOverAt: Date,
  staleBefore: number,
  clipped: boolean,
): CustodyView => {
  const { lastSeenAt, lastLatitude, lastLongitude, lastPositionAt, batteryPct, lastBatteryAt } = device;
  const heard = lastSeenAt !== null && lastSeenAt.getTime() >= handedOverAt.getTime();
  const state: UnitState = !heard
    ? 'NOT_HEARD'
    : lastSeenAt.getTime() < staleBefore
      ? 'OFFLINE'
      : 'LIVE';
  // A position stored before `lastPositionAt` existed has no time: staff see it at the last-seen time,
  // an organization does not see it, because nothing places it inside the custody interval.
  const fixAt = clipped ? lastPositionAt : (lastPositionAt ?? lastSeenAt);
  const plotted =
    lastLatitude !== null &&
    lastLongitude !== null &&
    fixAt !== null &&
    (!clipped || fixAt.getTime() >= handedOverAt.getTime());
  const hidden = clipped && !heard;
  return {
    state,
    stale: state === 'OFFLINE',
    position: plotted ? { lat: lastLatitude, lon: lastLongitude, at: fixAt.toISOString() } : null,
    lastSeenAt: hidden ? null : (lastSeenAt?.toISOString() ?? null),
    // An organization sees a battery only when the reading that carried it lies in its custody: a reading
    // since the handover without a battery value leaves the previous custody's battery stored.
    batteryPct:
      hidden || (clipped && (lastBatteryAt === null || lastBatteryAt.getTime() < handedOverAt.getTime()))
        ? null
        : batteryPct,
  };
};
