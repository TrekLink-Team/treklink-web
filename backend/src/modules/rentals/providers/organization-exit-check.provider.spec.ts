import { Prisma } from '@prisma/client';
import { OrganizationExitCheck } from '../../organizations';
import { ContractsService } from '../contracts.service';
import { RentalsOrganizationExitCheck } from './organization-exit-check.provider';

const TX = { tx: true } as unknown as Prisma.TransactionClient;

describe('RentalsOrganizationExitCheck (organizations port ORGANIZATION_EXIT_CHECKS)', () => {
  let contracts: { canClose: jest.Mock };

  beforeEach(() => {
    contracts = { canClose: jest.fn().mockResolvedValue(true) };
  });

  it('adds itself to the array of the port, and registers nowhere without the port', () => {
    const checks: OrganizationExitCheck[] = [];
    const check = new RentalsOrganizationExitCheck(
      contracts as unknown as ContractsService,
      checks,
    );
    expect(checks).toEqual([check]);

    expect(
      () => new RentalsOrganizationExitCheck(contracts as unknown as ContractsService),
    ).not.toThrow();
  });

  it('lets an organization with no unfinished contract close, reading in the closing transaction', async () => {
    const check = new RentalsOrganizationExitCheck(contracts as unknown as ContractsService);
    await expect(check.canClose('org-1', TX)).resolves.toBeNull();
    expect(contracts.canClose).toHaveBeenCalledWith('org-1', TX);
  });

  it('blocks a closing with OPEN_CONTRACTS while a contract is unfinished', async () => {
    contracts.canClose.mockResolvedValue(false);
    const check = new RentalsOrganizationExitCheck(contracts as unknown as ContractsService);
    await expect(check.canClose('org-1', TX)).resolves.toEqual({
      code: 'OPEN_CONTRACTS',
      message: 'This cannot be done while it has open contracts.',
    });
  });

  it('has no view on a reactivation', async () => {
    const check = new RentalsOrganizationExitCheck(contracts as unknown as ContractsService);
    await expect(check.canReactivate()).resolves.toBeNull();
  });
});
