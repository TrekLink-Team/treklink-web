import { DeviceStatus } from '@prisma/client';
import { DEVICE_STATUS_LABEL, stateSummary } from './device-status-labels';

describe('device state summary (monitoring api-design 07, screen 4.2 history)', () => {
  it('labels every device state', () => {
    for (const status of Object.values(DeviceStatus)) {
      expect(DEVICE_STATUS_LABEL[status]).toMatch(/^[A-Z][a-z ]+$/);
    }
  });

  it('reads the first row as the registration', () => {
    expect(
      stateSummary({
        fromStatus: null,
        toStatus: DeviceStatus.IN_INTAKE,
        reason: 'REGISTERED',
        note: null,
      }),
    ).toBe('Registered as In intake');
  });

  it('reads a move with labelled states and the reason, never the enum names', () => {
    const summary = stateSummary({
      fromStatus: DeviceStatus.RETURNED,
      toStatus: DeviceStatus.AVAILABLE,
      reason: 'INSPECTION_PASS',
      note: null,
    });
    expect(summary).toBe('From Returned to Available (Inspection pass)');
    expect(summary).not.toMatch(/RETURNED|AVAILABLE/);
  });

  it('adds the note after the move', () => {
    expect(
      stateSummary({
        fromStatus: DeviceStatus.MAINTENANCE,
        toStatus: DeviceStatus.RETIRED,
        reason: 'RETIRED',
        note: 'Water damage',
      }),
    ).toBe('From Maintenance to Retired (Retired): Water damage');
  });
});
