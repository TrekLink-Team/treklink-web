import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { IncidentsRepository } from '../incidents.repository';
import { IncidentsCloseCheck } from './contract-close-check.provider';

// The incidents side of CONTRACT_CLOSE_CHECKS (rentals api-design 17, AC-06, FR-CON-13).
describe('IncidentsCloseCheck', () => {
  const findMany = jest.fn();
  const tx = { incident: { findMany } } as unknown as Prisma.TransactionClient;
  const check = new IncidentsCloseCheck(new IncidentsRepository({} as PrismaService));

  beforeEach(() => findMany.mockReset());

  it('blocks the close while an incident on the contract or its devices is not CLOSED (MSG29)', async () => {
    findMany.mockResolvedValue([{ id: 'inc-1', code: 'INC-2026-000002' }]);
    await expect(check.blockingReason('c-1', ['d-1', 'd-2'], tx)).resolves.toEqual({
      code: 'OPEN_INCIDENTS',
      message: 'This cannot be done while it has open incidents.',
      // The close check of rentals api-design 20 links each incident.
      refs: [{ id: 'inc-1', code: 'INC-2026-000002' }],
    });
    expect(findMany).toHaveBeenCalledWith({
      where: {
        state: { not: 'CLOSED' },
        OR: [{ contractId: 'c-1' }, { deviceId: { in: ['d-1', 'd-2'] } }],
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, code: true },
    });
  });

  it('lets the close through when every incident is CLOSED', async () => {
    findMany.mockResolvedValue([]);
    await expect(check.blockingReason('c-1', ['d-1'], tx)).resolves.toBeNull();
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});
