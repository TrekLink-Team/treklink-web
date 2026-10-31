// In-process events of the staleness sweep (task 2.4, platform design §2.3). The sweep emits them after
// the commit that stored the transition; StreamListener turns each into its stream entry
// (`device.stale`, `station.stale` of ws-live-contract).
export const DEVICE_STALE_CHANGED = 'monitoring.deviceStale';
export const STATION_STALE_CHANGED = 'monitoring.stationStale';

export interface DeviceStaleChangedEvent {
  deviceId: string;
  /** The holder's organization; null for a device out of custody, whose recovery goes to `fleet` only. */
  organizationId: string | null;
  stale: boolean;
  lastSeenAt: string;
}

export interface StationStaleChangedEvent {
  fieldStationId: string;
  organizationId: string;
  stale: boolean;
  lastSyncAt: string;
}
