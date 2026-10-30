import { Prisma } from '@prisma/client';
import { OrganizationExitCheck } from '../../organizations';
import { BalanceService } from '../balance.service';
import { BillingOrganizationExitCheck } from './organization-exit-check.provider';

const TX = { tx: true } as unknown as Prisma.TransactionClient;
const AT = new Date('2026-10-30T03:00:00.000Z');

describe('BillingOrganizationExitCheck (organizations port ORGANIZATION_EXIT_CHECKS)', () => {
  let balances: { dueUnpaidOfOrganization: jest.Mock; pendingDamageOfOrganization: jest.Mock };

  beforeEach(() => {
    balances = {
      dueUnpaidOfOrganization: jest.fn().mockResolvedValue(0n),
      pendingDamageOfOrganization: jest.fn().mockResolvedValue(0),
    };
  });

  it('adds itself to the array of the port, and registers nowhere without the port', () => {
    const checks: OrganizationExitCheck[] = [];
    const check = new BillingOrganizationExitCheck(balances as unknown as BalanceService, checks);
    expect(checks).toEqual([check]);

    expect(
      () => new BillingOrganizationExitCheck(balances as unknown as BalanceService),
    ).not.toThrow();
  });

  it('lets an organization with nothing outstanding be reactivated, reading in the transaction', async () => {
    const check = new BillingOrganizationExitCheck(balances as unknown as BalanceService);
    await expect(check.canReactivate('org-1', TX, AT)).resolves.toBeNull();
    expect(balances.dueUnpaidOfOrganization).toHaveBeenCalledWith('org-1', AT, TX);
    expect(balances.pendingDamageOfOrganization).toHaveBeenCalledWith('org-1', TX);
  });

  it('blocks a reactivation while a damage charge waits for an Admin, with nothing invoiced owed (task 1.3)', async () => {
    balances.pendingDamageOfOrganization.mockResolvedValue(1);
    const check = new BillingOrganizationExitCheck(balances as unknown as BalanceService);
    await expect(check.canReactivate('org-1', TX, AT)).resolves.toEqual({
      code: 'BALANCE_OUTSTANDING',
      message: 'This cannot be done while it has open balances.',
    });
  });

  it('blocks a reactivation with BALANCE_OUTSTANDING while a line is due and unpaid', async () => {
    balances.dueUnpaidOfOrganization.mockResolvedValue(1n);
    const check = new BillingOrganizationExitCheck(balances as unknown as BalanceService);
    await expect(check.canReactivate('org-1', TX, AT)).resolves.toEqual({
      code: 'BALANCE_OUTSTANDING',
      message: 'This cannot be done while it has open balances.',
    });
    // Something owed already refuses; the damage charges are not read (review of #154).
    expect(balances.pendingDamageOfOrganization).not.toHaveBeenCalled();
  });

  it('has no view on a closing', async () => {
    const check = new BillingOrganizationExitCheck(balances as unknown as BalanceService);
    await expect(check.canClose()).resolves.toBeNull();
  });
});
