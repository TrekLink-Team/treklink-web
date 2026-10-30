import { Prisma } from '@prisma/client';
import { AccountsService } from '../auth';
import { RosterService } from '../organizations';
import { RoutingService } from './routing.service';

const tx = { tx: true } as unknown as Prisma.TransactionClient;
const AT = new Date('2026-10-29T03:00:00Z');

describe('RoutingService (incidents 2.2)', () => {
  let roster: { tiersAt: jest.Mock };
  let accounts: { activeStaffAndAdminIds: jest.Mock };
  let routing: RoutingService;

  beforeEach(() => {
    roster = {
      tiersAt: jest.fn().mockResolvedValue({ primary: ['p'], backup: ['b'], managers: ['m'] }),
    };
    accounts = { activeStaffAndAdminIds: jest.fn().mockResolvedValue(['s-1', 's-2']) };
    routing = new RoutingService(
      roster as unknown as RosterService,
      accounts as unknown as AccountsService,
    );
  });

  it('routes an attributed event to the primary tier of its organization, staff empty', async () => {
    await expect(
      routing.route({ organizationId: 'org-a', contractId: 'c-a' }, AT, tx),
    ).resolves.toEqual({
      to: 'NOTIFY_PRIMARY',
      recipients: { primary: ['p'], backup: ['b'], managers: ['m'], staff: [] },
    });
    expect(roster.tiersAt).toHaveBeenCalledWith('org-a', AT, tx);
  });

  it('keeps NOTIFY_PRIMARY when only later tiers have members; the lifecycle skips empty ones', async () => {
    roster.tiersAt.mockResolvedValue({ primary: [], backup: [], managers: ['m'] });
    await expect(
      routing.route({ organizationId: 'org-a', contractId: null }, AT, tx),
    ).resolves.toMatchObject({ to: 'NOTIFY_PRIMARY' });
  });

  it('gives a timer the tiers of the routed organization and the active Staff and Admin (task 3.1, D-079)', async () => {
    await expect(routing.recipientsOf('org-a', AT, tx)).resolves.toEqual({
      primary: ['p'],
      backup: ['b'],
      managers: ['m'],
      staff: ['s-1', 's-2'],
    });
    expect(roster.tiersAt).toHaveBeenCalledWith('org-a', AT, tx);
    expect(accounts.activeStaffAndAdminIds).toHaveBeenCalledWith(tx);
  });

  it('gives a timer no tier for an incident without an organization', async () => {
    await expect(routing.recipientsOf(null, AT, tx)).resolves.toEqual({
      primary: [],
      backup: [],
      managers: [],
      staff: [],
    });
    expect(roster.tiersAt).not.toHaveBeenCalled();
    expect(accounts.activeStaffAndAdminIds).not.toHaveBeenCalled();
  });

  it('sends an unattributed event to UNROUTED without reading a roster (BR-36)', async () => {
    await expect(
      routing.route({ organizationId: null, contractId: null }, AT, tx),
    ).resolves.toEqual({
      to: 'UNROUTED',
      recipients: { primary: [], backup: [], managers: [], staff: [] },
    });
    expect(roster.tiersAt).not.toHaveBeenCalled();
  });

  it('sends an organization with nobody to alert to UNROUTED', async () => {
    roster.tiersAt.mockResolvedValue({ primary: [], backup: [], managers: [] });
    await expect(
      routing.route({ organizationId: 'org-a', contractId: 'c-a' }, AT, tx),
    ).resolves.toMatchObject({ to: 'UNROUTED' });
  });
});
