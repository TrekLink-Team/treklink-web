import { DeviceStatus } from '@prisma/client';
import {
  CHECK_POLICIES_KEY,
  PolicyAbility,
  PolicyHandler,
} from '../../common/decorators/access.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DevicesController } from './devices.controller';
import { DevicesRepository } from './devices.repository';
import { DevicesService } from './devices.service';

// devices api-design 24, the advisory count of screen 5.3.
describe('device availability', () => {
  const groupBy = jest.fn();
  const findMany = jest.fn();
  const service = new DevicesService(
    new DevicesRepository({
      hardwareVariant: { findMany },
      device: { groupBy },
    } as unknown as PrismaService),
    {} as never,
    {} as never,
    { custodyAt: () => Promise.resolve(null) },
  );

  beforeEach(() => {
    findMany.mockResolvedValue([
      { id: 'v-2', code: 'treklink-v2' },
      { id: 'v-3', code: 'treklink-v3' },
    ]);
    groupBy.mockResolvedValue([{ hardwareVariantId: 'v-3', _count: { _all: 10 } }]);
  });

  it('counts AVAILABLE units per active variant, listing a variant with none at zero', async () => {
    await expect(service.availability()).resolves.toEqual([
      { hardwareVariantId: 'v-2', code: 'treklink-v2', available: 0 },
      { hardwareVariantId: 'v-3', code: 'treklink-v3', available: 10 },
    ]);
    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: DeviceStatus.AVAILABLE } }),
    );
  });

  it('narrows to one variant when asked', async () => {
    await service.availability('v-3');
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: 'v-3' } }));
    expect(groupBy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { status: DeviceStatus.AVAILABLE, hardwareVariantId: 'v-3' },
      }),
    );
  });

  it('checks the readAvailability action on Device', () => {
    const handlers = Reflect.getMetadata(
      CHECK_POLICIES_KEY,
      Object.getOwnPropertyDescriptor(DevicesController.prototype, 'availability')?.value as object,
    ) as PolicyHandler[];
    const can = jest.fn().mockReturnValue(true);
    const ability: PolicyAbility = { can };
    expect(handlers.every((handler) => handler(ability))).toBe(true);
    expect(can).toHaveBeenCalledWith('readAvailability', 'Device');
  });
});
