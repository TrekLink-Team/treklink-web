import { DeviceStatus } from '@prisma/client';
import { DomainException } from '../../common/errors';
import { DevicesRepository } from './devices.repository';
import { DevicesService } from './devices.service';

const device = {
  id: 'dev-1',
  assetTag: 'TL-0009',
  nodeNum: 0xde000009n,
  status: DeviceStatus.RENTED,
};
const at = new Date('2026-10-23T03:00:00Z');

describe('DevicesService', () => {
  let repository: {
    findByNodeNum: jest.Mock;
    projectIfNewer: jest.Mock;
    findValuation: jest.Mock;
  };
  let service: DevicesService;

  beforeEach(() => {
    repository = {
      findByNodeNum: jest.fn().mockResolvedValue(device),
      projectIfNewer: jest.fn().mockResolvedValue(true),
      findValuation: jest.fn(),
    };
    service = new DevicesService(
      repository as unknown as DevicesRepository,
      {} as never,
      {} as never,
    );
  });

  it('projects a position reading and returns the device id', async () => {
    await expect(
      service.projectReading(device.nodeNum, {
        at,
        position: { latitude: 11.55, longitude: 108.54 },
      }),
    ).resolves.toBe('dev-1');
    expect(repository.projectIfNewer).toHaveBeenCalledWith(
      'dev-1',
      { at, latitude: 11.55, longitude: 108.54, batteryPct: undefined },
      undefined,
    );
  });

  it('projects a telemetry reading without touching the position', async () => {
    await service.projectReading(device.nodeNum, { at, batteryPct: 87 });
    expect(repository.projectIfNewer).toHaveBeenCalledWith(
      'dev-1',
      { at, latitude: undefined, longitude: undefined, batteryPct: 87 },
      undefined,
    );
  });

  it('still returns the device id when an older reading is discarded', async () => {
    repository.projectIfNewer.mockResolvedValue(false);
    await expect(service.projectReading(device.nodeNum, { at, batteryPct: 50 })).resolves.toBe(
      'dev-1',
    );
  });

  it('returns null for an unknown node number and projects nothing', async () => {
    repository.findByNodeNum.mockResolvedValue(null);
    await expect(service.projectReading(1n, { at })).resolves.toBeNull();
    expect(repository.projectIfNewer).not.toHaveBeenCalled();
  });

  it('values a device from its variant schedule, or 404 for an unknown device', async () => {
    repository.findValuation.mockResolvedValue({
      acquiredAt: new Date('2025-01-01T00:00:00Z'),
      hardwareVariant: {
        remainingValueSchedule: [
          { fromMonths: 0, valueVnd: 2500000 },
          { fromMonths: 12, valueVnd: 1800000 },
        ],
      },
    });
    await expect(service.valueAt('dev-1', at)).resolves.toBe(1800000);

    repository.findValuation.mockResolvedValue(null);
    await expect(service.valueAt('nope', at)).rejects.toBeInstanceOf(DomainException);
  });
});
