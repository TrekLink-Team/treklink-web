import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { IncidentsRepository } from '../incidents.repository';
import { IncidentsCloseCheck } from './contract-close-check.provider';

// The incidents side of CONTRACT_CLOSE_CHECKS (rentals api-design 17, AC-06, FR-CON-13).
describe('IncidentsCloseCheck', () => {
  const count = jest.fn();
  const tx = { incident: { count } } as unknown as Prisma.TransactionClient;
  const check = new IncidentsCloseCheck(new IncidentsRepository({} as PrismaService));

  beforeEach(() => count.mockReset());

  it('blocks the close while an incident on the contract or its devices is not CLOSED (MSG29)', async () => {
    count.mockResolvedValue(1);
    await expect(check.blockingReason('c-1', ['d-1', 'd-2'], tx)).resolves.toEqual({
      code: 'OPEN_INCIDENTS',
      message: 'This cannot be done while it has open incidents.',
    });
    expect(count).toHaveBeenCalledWith({
      where: {
        state: { not: 'CLOSED' },
        OR: [{ contractId: 'c-1' }, { deviceId: { in: ['d-1', 'd-2'] } }],
      },
    });
  });

  it('lets the close through when every incident is CLOSED', async () => {
    count.mockResolvedValue(0);
    await expect(check.blockingReason('c-1', ['d-1'], tx)).resolves.toBeNull();
    expect(count).toHaveBeenCalledTimes(1);
  });
});
