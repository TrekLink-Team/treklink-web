import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RosterRepository } from './roster.repository';
import { RosterService } from './roster.service';

const tx = { tx: true } as unknown as Prisma.TransactionClient;
const AT = new Date('2026-10-29T03:00:00Z');

describe('RosterService.tiersAt (organizations 2.6, read only)', () => {
  let roster: { slotsAt: jest.Mock; managerUserIds: jest.Mock };
  let service: RosterService;

  beforeEach(() => {
    roster = {
      slotsAt: jest.fn().mockResolvedValue({ primaryUserId: 'u-p', backupUserId: 'u-b' }),
      managerUserIds: jest.fn().mockResolvedValue(['u-m1', 'u-m2']),
    };
    service = new RosterService(roster as unknown as RosterRepository);
  });

  it('returns the shift primary, backup and every live Manager as user ids, in the caller tx', async () => {
    await expect(service.tiersAt('org-1', AT, tx)).resolves.toEqual({
      primary: ['u-p'],
      backup: ['u-b'],
      managers: ['u-m1', 'u-m2'],
    });
    expect(roster.slotsAt).toHaveBeenCalledWith('org-1', AT, tx);
    expect(roster.managerUserIds).toHaveBeenCalledWith('org-1', tx);
  });

  it('gives empty tiers for no shift, or a shift without a primary or with a deactivated backup', async () => {
    roster.slotsAt.mockResolvedValue({ primaryUserId: null, backupUserId: null });
    roster.managerUserIds.mockResolvedValue([]);
    await expect(service.tiersAt('org-1', AT)).resolves.toEqual({
      primary: [],
      backup: [],
      managers: [],
    });
  });
});

describe('RosterRepository', () => {
  const member = (userId: string, deactivatedAt: Date | null = null) => ({ userId, deactivatedAt });

  it('reads the shift covering the instant, half-open, and keeps only live members', async () => {
    const findFirst = jest.fn().mockResolvedValue({
      primaryMember: member('u-p'),
      backupMember: member('u-b', new Date('2026-10-01T00:00:00Z')),
    });
    const client = { rosterShift: { findFirst } } as unknown as Prisma.TransactionClient;
    const repository = new RosterRepository({} as PrismaService);
    await expect(repository.slotsAt('org-1', AT, client)).resolves.toEqual({
      primaryUserId: 'u-p',
      backupUserId: null,
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org-1', startsAt: { lte: AT }, endsAt: { gt: AT } },
      }),
    );
  });

  it('answers empty slots when no shift covers the instant', async () => {
    const prisma = { rosterShift: { findFirst: jest.fn().mockResolvedValue(null) } };
    const repository = new RosterRepository(prisma as unknown as PrismaService);
    await expect(repository.slotsAt('org-1', AT)).resolves.toEqual({
      primaryUserId: null,
      backupUserId: null,
    });
  });

  it('lists the account ids of live Managers', async () => {
    const findMany = jest.fn().mockResolvedValue([{ userId: 'u-m1' }]);
    const prisma = { organizationMember: { findMany } };
    const repository = new RosterRepository(prisma as unknown as PrismaService);
    await expect(repository.managerUserIds('org-1')).resolves.toEqual(['u-m1']);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org-1', role: 'MANAGER', deactivatedAt: null },
      }),
    );
  });
});
