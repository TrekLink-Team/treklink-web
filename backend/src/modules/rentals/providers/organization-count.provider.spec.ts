import { ContractStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { OrganizationCountProvider } from '../../organizations';
import { ContractsRepository } from '../contracts.repository';
import { ContractsService } from '../contracts.service';
import { RentalsOrganizationCount } from './organization-count.provider';

describe('RentalsOrganizationCount (organizations port ORGANIZATION_COUNTS)', () => {
  it('adds itself to the array of the port, and registers nowhere without the port', () => {
    const counts: OrganizationCountProvider[] = [];
    const provider = new RentalsOrganizationCount({} as ContractsService, counts);
    expect(counts).toEqual([provider]);
    expect(provider.name).toBe('runningContracts');

    expect(() => new RentalsOrganizationCount({} as ContractsService)).not.toThrow();
  });

  it('counts through the contracts service', async () => {
    const contracts = { countRunning: jest.fn().mockResolvedValue(2) };
    const provider = new RentalsOrganizationCount(contracts as unknown as ContractsService);
    await expect(provider.count('org-1')).resolves.toBe(2);
    expect(contracts.countRunning).toHaveBeenCalledWith('org-1');
  });

  it('counts the contracts whose devices are out, from the repository', async () => {
    const count = jest.fn().mockResolvedValue(3);
    const client = { rentalContract: { count } } as unknown as Prisma.TransactionClient;
    const repository = new ContractsRepository({
      rentalContract: { count },
    } as unknown as PrismaService);

    await expect(repository.countRunningContracts('org-1')).resolves.toBe(3);
    await repository.countRunningContracts('org-1', client);

    expect(count).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        status: {
          in: [
            ContractStatus.ACTIVE,
            ContractStatus.ENDING,
            ContractStatus.RETURN_DUE,
            ContractStatus.OVERDUE,
          ],
        },
      },
    });
    expect(count).toHaveBeenCalledTimes(2);
  });

  it('answers the service count from the repository', async () => {
    const repository = { countRunningContracts: jest.fn().mockResolvedValue(5) };
    const service = Object.create(ContractsService.prototype) as ContractsService;
    Object.assign(service, { contracts: repository });
    await expect(service.countRunning('org-1')).resolves.toBe(5);
    expect(repository.countRunningContracts).toHaveBeenCalledWith('org-1');
  });
});
