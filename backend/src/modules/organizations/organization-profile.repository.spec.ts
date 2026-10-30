import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MembersRepository } from './members.repository';
import { OrganizationsRepository, REVIEW_SELECT } from './organizations.repository';

describe('The reads the organization detail needs (api-design 03)', () => {
  it('reads the review row with the account that verified it', async () => {
    const findUnique = jest.fn().mockResolvedValue({ id: 'org-1' });
    const repository = new OrganizationsRepository({
      organization: { findUnique },
    } as unknown as PrismaService);

    await expect(repository.findDetail('org-1')).resolves.toEqual({ id: 'org-1' });
    await repository.findDetail('org-1', {
      organization: { findUnique },
    } as unknown as Prisma.TransactionClient);

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      select: { ...REVIEW_SELECT, verifiedById: true },
    });
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it('counts the members who are not deactivated', async () => {
    const count = jest.fn().mockResolvedValue(4);
    const repository = new MembersRepository({
      organizationMember: { count },
    } as unknown as PrismaService);

    await expect(repository.countActive('org-1')).resolves.toBe(4);
    await repository.countActive('org-1', {
      organizationMember: { count },
    } as unknown as Prisma.TransactionClient);

    expect(count).toHaveBeenCalledWith({ where: { organizationId: 'org-1', deactivatedAt: null } });
    expect(count).toHaveBeenCalledTimes(2);
  });
});
