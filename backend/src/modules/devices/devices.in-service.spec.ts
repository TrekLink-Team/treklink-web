import { DeviceStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DevicesRepository } from './devices.repository';
import { DevicesService } from './devices.service';
import { IN_SERVICE } from './in-service';

// The units in service per hardware variant, for the utilization report (monitoring api-design 08).
describe('units in service', () => {
  const groupBy = jest.fn();
  const service = new DevicesService(
    new DevicesRepository({ device: { groupBy } } as unknown as PrismaService),
    {} as never,
    {} as never,
    { custodyAt: () => Promise.resolve(null) },
  );

  beforeEach(() => {
    groupBy.mockReset();
    groupBy.mockResolvedValue([
      { hardwareVariantId: 'v-2', _count: { _all: 4 } },
      { hardwareVariantId: 'v-3', _count: { _all: 10 } },
    ]);
  });

  it('counts the devices in a working state per variant', async () => {
    await expect(service.unitsInService()).resolves.toEqual([
      { hardwareVariantId: 'v-2', units: 4 },
      { hardwareVariantId: 'v-3', units: 10 },
    ]);
    expect(groupBy).toHaveBeenCalledWith({
      by: ['hardwareVariantId'],
      where: { status: { in: [...IN_SERVICE] } },
      _count: { _all: true },
    });
  });

  it('leaves out a lost, retired or disposed device', () => {
    expect(IN_SERVICE).toEqual([
      DeviceStatus.IN_INTAKE,
      DeviceStatus.AVAILABLE,
      DeviceStatus.RESERVED,
      DeviceStatus.RENTED,
      DeviceStatus.RETURNED,
      DeviceStatus.MAINTENANCE,
    ]);
    expect(IN_SERVICE).not.toContain(DeviceStatus.LOST);
    expect(IN_SERVICE).not.toContain(DeviceStatus.RETIRED);
    expect(IN_SERVICE).not.toContain(DeviceStatus.DISPOSED);
  });
});
