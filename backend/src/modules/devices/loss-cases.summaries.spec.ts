import { LossCaseState } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LossCasesRepository } from './loss-cases.repository';
import { LossCaseService } from './loss-cases.service';

// The newest loss case of each custody interval, for the lost report (monitoring api-design 08).
describe('loss case summaries of custody intervals', () => {
  const findMany = jest.fn();
  const repository = new LossCasesRepository({
    lossCase: { findMany },
  } as unknown as PrismaService);
  const none = {} as never;
  const service = new LossCaseService(
    repository,
    none,
    none,
    none,
    none,
    none,
    none,
    none,
    none,
    none,
    none,
  );

  beforeEach(() => findMany.mockReset());

  it('asks for the newest report first, with the code, state and charge', async () => {
    findMany.mockResolvedValue([]);
    await repository.forContractDevices(['cd-1', 'cd-2']);
    expect(findMany).toHaveBeenCalledWith({
      where: { contractDeviceId: { in: ['cd-1', 'cd-2'] } },
      orderBy: [{ reportedAt: 'desc' }, { id: 'asc' }],
      select: { id: true, contractDeviceId: true, code: true, state: true, chargeVnd: true },
    });
  });

  it('keeps the newest case of an interval and skips a case with no interval', async () => {
    findMany.mockResolvedValue([
      {
        id: 'lc-2',
        contractDeviceId: 'cd-1',
        code: 'LOSS-0002',
        state: LossCaseState.CONFIRMED,
        chargeVnd: 1_200_000,
      },
      {
        id: 'lc-1',
        contractDeviceId: 'cd-1',
        code: 'LOSS-0001',
        state: LossCaseState.REPORTED,
        chargeVnd: null,
      },
      {
        id: 'lc-3',
        contractDeviceId: null,
        code: 'LOSS-0003',
        state: LossCaseState.REPORTED,
        chargeVnd: null,
      },
    ]);
    const summaries = await service.summariesOfContractDevices(['cd-1']);
    expect([...summaries.entries()]).toEqual([
      [
        'cd-1',
        { id: 'lc-2', code: 'LOSS-0002', state: LossCaseState.CONFIRMED, chargeVnd: 1_200_000 },
      ],
    ]);
  });

  it('reads nothing for no intervals', async () => {
    await expect(service.summariesOfContractDevices([])).resolves.toEqual(new Map());
    expect(findMany).not.toHaveBeenCalled();
  });
});
