import { DockEndReason } from '@prisma/client';

// Emitted after commit when a dock session opens or ends (devices design section 12.8, REQ-EVT-39).
// `monitoring` turns them into `device.docked` and `device.undocked` stream entries with no
// organization, so they reach the `fleet` room only.
export const DEVICE_DOCKED = 'device.docked';
export const DEVICE_UNDOCKED = 'device.undocked';

export interface DeviceDockedEvent {
  deviceId: string;
  assetTag: string;
  since: Date;
  byName: string | null;
}

export interface DeviceUndockedEvent {
  deviceId: string;
  endedAt: Date;
  endReason: DockEndReason;
}
