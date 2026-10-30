import { MemberRole, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MembersRepository } from './members.repository';

const SELECT = { id: true, userId: true, role: true, deactivatedAt: true };
const AT = new Date('2026-10-30T03:00:00.000Z');

describe('MembersRepository, the write side of organizations 2.5', () => {
  let member: Record<string, jest.Mock>;
  let client: Prisma.TransactionClient;
  let repository: MembersRepository;

  beforeEach(() => {
    member = {
      create: jest.fn().mockResolvedValue({ id: 'm-1' }),
      findFirst: jest.fn().mockResolvedValue({ id: 'm-1' }),
      findMany: jest.fn().mockResolvedValue([{ userId: 'u-1' }, { userId: 'u-2' }]),
      update: jest.fn().mockResolvedValue({ id: 'm-1' }),
    };
    client = { organizationMember: member } as unknown as Prisma.TransactionClient;
    repository = new MembersRepository({ organizationMember: member } as unknown as PrismaService);
  });

  it('adds a member with the account that invited them', async () => {
    const row = {
      organizationId: 'org-1',
      userId: 'u-1',
      role: MemberRole.OPERATOR,
      invitedById: 'u-0',
    };
    await repository.addMember(row, client);
    expect(member.create).toHaveBeenCalledWith({ data: row, select: SELECT });
  });

  it('finds a member by id inside one organization only', async () => {
    await expect(repository.findInOrganization('org-1', 'm-1')).resolves.toEqual({ id: 'm-1' });
    expect(member.findFirst).toHaveBeenCalledWith({
      where: { id: 'm-1', organizationId: 'org-1' },
      select: SELECT,
    });
  });

  it('finds the live member row of an account in one organization', async () => {
    await expect(repository.findLiveMember('org-1', 'u-1')).resolves.toEqual({ id: 'm-1' });
    expect(member.findFirst).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', userId: 'u-1', deactivatedAt: null },
      select: SELECT,
    });
  });

  it('lists the account ids of the live Managers', async () => {
    await expect(repository.liveManagerUserIds('org-1', client)).resolves.toEqual(['u-1', 'u-2']);
    expect(member.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', role: MemberRole.MANAGER, deactivatedAt: null },
      select: { userId: true },
    });
  });

  it('lists them on the shared client when no transaction is given', async () => {
    await repository.liveManagerUserIds('org-1');
    expect(member.findMany).toHaveBeenCalledTimes(1);
  });

  it('sets a role and a deactivation time on the member row', async () => {
    await repository.setRole('m-1', MemberRole.MANAGER, client);
    expect(member.update).toHaveBeenLastCalledWith({
      where: { id: 'm-1' },
      data: { role: MemberRole.MANAGER },
      select: SELECT,
    });

    await repository.markDeactivated('m-1', AT, client);
    expect(member.update).toHaveBeenLastCalledWith({
      where: { id: 'm-1' },
      data: { deactivatedAt: AT },
      select: SELECT,
    });
  });
});
