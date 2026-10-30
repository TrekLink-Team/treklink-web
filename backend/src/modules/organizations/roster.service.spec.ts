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

describe('RosterRepository, shift administration (organizations 2.6)', () => {
  const FROM = new Date('2026-10-20T00:00:00Z');
  const TO = new Date('2026-10-27T00:00:00Z');
  let shift: Record<string, jest.Mock>;
  let client: Prisma.TransactionClient;
  let repository: RosterRepository;

  beforeEach(() => {
    shift = {
      findMany: jest.fn().mockResolvedValue([{ id: 's-1' }]),
      findFirst: jest.fn().mockResolvedValue({ id: 's-1' }),
      create: jest.fn().mockResolvedValue({ id: 's-1' }),
      update: jest.fn().mockResolvedValue({ id: 's-1' }),
      delete: jest.fn().mockResolvedValue({ id: 's-1' }),
    };
    const member = { findMany: jest.fn().mockResolvedValue([{ id: 'm-1', userId: 'u-1' }]) };
    client = {
      rosterShift: shift,
      organizationMember: member,
    } as unknown as Prisma.TransactionClient;
    repository = new RosterRepository({
      rosterShift: shift,
      organizationMember: member,
    } as unknown as PrismaService);
  });

  it('lists the shifts touching a window, earliest first', async () => {
    await expect(repository.shiftsBetween('org-1', FROM, TO)).resolves.toEqual([{ id: 's-1' }]);
    expect(shift.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org-1', startsAt: { lt: TO }, endsAt: { gt: FROM } },
        orderBy: { startsAt: 'asc' },
      }),
    );
  });

  it('finds a shift inside one organization only', async () => {
    await repository.findShift('org-1', 's-1');
    expect(shift.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 's-1', organizationId: 'org-1' } }),
    );
  });

  it('asks for an overlap with half-open windows, leaving the edited shift out when given', async () => {
    await expect(repository.overlaps('org-1', FROM, TO, null, client)).resolves.toBe(true);
    expect(shift.findFirst).toHaveBeenLastCalledWith({
      where: { organizationId: 'org-1', startsAt: { lt: TO }, endsAt: { gt: FROM } },
      select: { id: true },
    });

    shift.findFirst.mockResolvedValueOnce(null);
    await expect(repository.overlaps('org-1', FROM, TO, 's-2')).resolves.toBe(false);
    expect(shift.findFirst).toHaveBeenLastCalledWith({
      where: {
        organizationId: 'org-1',
        startsAt: { lt: TO },
        endsAt: { gt: FROM },
        id: { not: 's-2' },
      },
      select: { id: true },
    });
  });

  it('keeps only the members of the organization that are not deactivated', async () => {
    await expect(repository.liveMembers('org-1', ['m-1'], client)).resolves.toEqual([
      { id: 'm-1', userId: 'u-1' },
    ]);
    await repository.liveMembers('org-1', ['m-1']);
  });

  it('inserts, updates and deletes a shift in the caller transaction', async () => {
    const data = {
      organizationId: 'org-1',
      startsAt: FROM,
      endsAt: TO,
      primaryMemberId: 'm-1',
      backupMemberId: null,
      createdById: 'u-1',
    };
    await repository.insertShift(data, client);
    expect(shift.create).toHaveBeenCalledWith(expect.objectContaining({ data }));

    await repository.updateShift('s-1', { endsAt: TO }, client);
    expect(shift.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 's-1' }, data: { endsAt: TO } }),
    );

    await expect(repository.deleteShift('s-1', client)).resolves.toBeUndefined();
    expect(shift.delete).toHaveBeenCalledWith({ where: { id: 's-1' } });
  });
});
