import { Prisma } from '@prisma/client';
import { RosterRepository } from './roster.repository';
import { PrismaService } from '../../common/prisma/prisma.service';

const AT = new Date('2026-10-30T03:00:00.000Z');

describe('RosterRepository.clearMember (organizations 2.5, REQ-EVT-08)', () => {
  it('empties the primary and the backup slot of every shift that has not ended', async () => {
    const updateMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValueOnce({ count: 1 });
    const client = { rosterShift: { updateMany } } as unknown as Prisma.TransactionClient;
    const repository = new RosterRepository({} as PrismaService);

    await expect(repository.clearMember('m-1', AT, client)).resolves.toBe(3);

    expect(updateMany).toHaveBeenNthCalledWith(1, {
      where: { primaryMemberId: 'm-1', endsAt: { gt: AT } },
      data: { primaryMemberId: null },
    });
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: { backupMemberId: 'm-1', endsAt: { gt: AT } },
      data: { backupMemberId: null },
    });
  });
});
