import { DeviceStatus } from '@prisma/client';
import { DeviceListRow } from './devices.repository';
import { toDeviceView } from './device-view';

const row = {
  id: 'dev-1',
  assetTag: 'TL-0019',
  nodeNum: 0xde000019n,
  firmwareVersion: '2.7.19-treklink.3',
  acquiredAt: new Date('2026-06-15T00:00:00Z'),
  status: DeviceStatus.AVAILABLE,
  statusChangedAt: new Date('2026-10-30T03:00:00Z'),
  keyVersion: null,
  keyOrganizationId: null,
  batteryPct: null,
  lastSeenAt: null,
  lastLatitude: null,
  lastLongitude: null,
  serviceDueAt: null,
  version: 1,
  hardwareVariant: {
    id: 'v-3',
    code: 'treklink-v3',
    name: 'TrekLink v3',
    imageUrl: null,
    specSheet: { mcu: 'ESP32' },
    hasGps: true,
    hasMotionSensor: false,
    mqttCapable: true,
  },
} as DeviceListRow;

describe('toDeviceView (devices api-design 05 to 07)', () => {
  it('carries the shared variant summary of design section 10', () => {
    expect(toDeviceView(row).hardwareVariant).toEqual({
      id: 'v-3',
      code: 'treklink-v3',
      name: 'TrekLink v3',
      imageUrl: null,
      specSheet: { mcu: 'ESP32' },
      hasGps: true,
      hasMotionSensor: false,
      mqttCapable: true,
    });
  });
});
