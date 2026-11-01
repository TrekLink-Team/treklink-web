import { PrismaService } from '../../common/prisma/prisma.service';
import { ContractsRepository } from './contracts.repository';
import { ContractsService } from './contracts.service';

// The holder-label read the MF-03 PR adds for incidents (incidents 2.1 and 5.1).
describe('ContractsService.holderLabels', () => {
  it('keys the latest handed-over label per contract and device, and skips erased labels', async () => {
    const findHolderLabels = jest.fn().mockResolvedValue([
      { contractId: 'c-1', deviceId: 'd-1', holderName: 'Le Thi E', holderPhone: '0912' },
      { contractId: 'c-1', deviceId: 'd-1', holderName: 'Older label', holderPhone: null },
      { contractId: 'c-1', deviceId: 'd-2', holderName: null, holderPhone: null },
    ]);
    const service = new ContractsService(
      { findHolderLabels } as unknown as ContractsRepository,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(service.holderLabels([])).resolves.toEqual(new Map());
    expect(findHolderLabels).not.toHaveBeenCalled();
    await expect(
      service.holderLabels([
        { contractId: 'c-1', deviceId: 'd-1' },
        { contractId: 'c-1', deviceId: 'd-2' },
      ]),
    ).resolves.toEqual(new Map([['c-1:d-1', { name: 'Le Thi E', phone: '0912' }]]));
  });

  it('reads handed-over rows of the pairs, latest first', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const repository = new ContractsRepository({
      contractDevice: { findMany },
    } as unknown as PrismaService);
    await repository.findHolderLabels([{ contractId: 'c-1', deviceId: 'd-1' }]);
    expect(findMany).toHaveBeenCalledWith({
      where: { handedOverAt: { not: null }, OR: [{ contractId: 'c-1', deviceId: 'd-1' }] },
      orderBy: { handedOverAt: 'desc' },
      select: { contractId: true, deviceId: true, holderName: true, holderPhone: true },
    });
  });
});

describe('ContractsRepository.findInCustody (monitoring design §4)', () => {
  it('reads open custody rows of one organization, or of all for a null scope', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const repository = new ContractsRepository({
      contractDevice: { findMany },
    } as unknown as PrismaService);
    await repository.findInCustody('org-1');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          handedOverAt: { not: null },
          checkedInAt: null,
          lostAt: null,
          contract: { organizationId: 'org-1' },
        },
      }),
    );
    // The custody interval's start travels with the row (monitoring REQ-UBI-04, D-092 rule 2).
    const [query] = findMany.mock.calls[0] as [{ select: Record<string, unknown> }];
    expect(query.select).toMatchObject({ handedOverAt: true });
    await repository.findInCustody(null);
    expect(findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { handedOverAt: { not: null }, checkedInAt: null, lostAt: null },
      }),
    );
  });
});
