import { PrismaService } from '../../common/prisma/prisma.service';
import { ContractsRepository } from './contracts.repository';
import { ContractsService } from './contracts.service';

// The status read incidents uses for a report on a DEFAULTED contract (incidents api-design 10).
describe('ContractsService.statusOf', () => {
  it('returns the status, or null for no contract, from a plain read', async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce({ status: 'DEFAULTED' })
      .mockResolvedValueOnce(null);
    const repository = new ContractsRepository({
      rentalContract: { findUnique },
    } as unknown as PrismaService);
    const service = new ContractsService(
      repository,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(service.statusOf('c-1')).resolves.toBe('DEFAULTED');
    await expect(service.statusOf('c-9')).resolves.toBeNull();
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'c-1' }, select: { status: true } });
  });
});
