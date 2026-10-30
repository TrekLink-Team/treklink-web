import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { IntakeService } from './intake.service';

const CONFIG = {
  get: jest.fn((key: string) => (key === 'DEFAULT_PAGE_SIZE' ? 20 : 100)),
} as never;

const CALLER = { id: 'staff-1', roles: ['STAFF'], organizationId: null };

describe('DevicesController (devices api-design 05 to 09, task 4.1)', () => {
  let devices: {
    fleetPage: jest.Mock;
    reset: jest.Mock;
    availability: jest.Mock;
    detail: jest.Mock;
  };
  let intake: { record: jest.Mock; register: jest.Mock };
  let events: { transaction: jest.Mock };
  let controller: DevicesController;

  beforeEach(() => {
    devices = {
      fleetPage: jest.fn().mockResolvedValue([[], 0]),
      reset: jest.fn(),
      availability: jest.fn().mockResolvedValue([]),
      detail: jest.fn().mockResolvedValue({ id: 'd-1' }),
    };
    intake = { record: jest.fn(), register: jest.fn().mockResolvedValue({ id: 'd-new' }) };
    events = { transaction: jest.fn((cb: (tx: object) => unknown) => cb({})) };
    controller = new DevicesController(
      devices as unknown as DevicesService,
      intake as unknown as IntakeService,
      events as never,
      CONFIG,
    );
  });

  it('registers a device inside a transaction (api-design 05)', async () => {
    const dto = {
      assetTag: 'TL-0042',
      nodeNum: 1,
      hardwareVariantId: 'v-3',
      firmwareVersion: '1.0',
      acquiredAt: '2026-01-01',
    };
    await expect(controller.register(dto, CALLER)).resolves.toEqual({ id: 'd-new' });
    expect(intake.register).toHaveBeenCalledWith(dto, 'staff-1', expect.any(Date), {});
  });

  it('lists the fleet page with the query filters', async () => {
    await controller.list({ status: ['AVAILABLE'], hardwareVariantId: 'v-3', q: ' TL ' });
    expect(devices.fleetPage).toHaveBeenCalledWith(
      { statuses: ['AVAILABLE'], hardwareVariantId: 'v-3', q: 'TL' },
      0,
      20,
    );
  });

  it('reads availability and the device detail', async () => {
    await controller.availability({ hardwareVariantId: 'v-3' });
    expect(devices.availability).toHaveBeenCalledWith('v-3');
    await expect(controller.detail('d-1')).resolves.toEqual({ id: 'd-1' });
  });

  it('records a reset and an intake check inside a transaction', async () => {
    const resetDto = { keyRemoved: true, nodeDbCleared: true, ownerCleared: true };
    await controller.reset('d-1', resetDto, CALLER);
    expect(devices.reset).toHaveBeenCalledWith('d-1', resetDto, 'staff-1', expect.any(Date), {});

    const intakeDto = { gpsFixOk: true, radioOk: true, batteryOk: true, expectedVersion: 0 };
    await controller.recordIntake('d-1', intakeDto, CALLER);
    expect(intake.record).toHaveBeenCalledWith('d-1', intakeDto, 'staff-1', expect.any(Date), {});
  });
});
