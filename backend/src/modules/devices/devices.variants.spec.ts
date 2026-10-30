import { PrismaService } from '../../common/prisma/prisma.service';
import { DevicesRepository } from './devices.repository';
import { DevicesService } from './devices.service';

// The read-only variant list for billing api-design 01 and rentals api-design 01.
describe('DevicesService.variants and DevicesRepository.variants', () => {
  it('lists the active variants by code by default, or every variant on request', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'v-3' }]);
    const repository = new DevicesRepository({
      hardwareVariant: { findMany },
    } as unknown as PrismaService);
    const service = new DevicesService(repository, {} as never, {} as never);

    await expect(service.variants()).resolves.toEqual([{ id: 'v-3' }]);
    expect(findMany).toHaveBeenLastCalledWith({
      where: { isActive: true },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true, isActive: true },
    });

    await service.variants(false);
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: {} }));
  });
});
