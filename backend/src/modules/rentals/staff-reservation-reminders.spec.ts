import { Prisma } from '@prisma/client';
import { OrganizationsService } from '../organizations';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import {
  ContractsRepository,
  RESERVATION_REMINDED,
  RESERVATION_STAFF_REMINDED,
} from './contracts.repository';
import { ReservationRemindersJob } from './reservation-reminders.job';

const TX = {} as Prisma.TransactionClient;
const AT = new Date('2026-10-30T02:00:00Z');
const candidate = {
  id: 'c-1',
  code: 'RC-2026-0001',
  organizationId: 'org-1',
  reservationExpiresAt: AT,
};

describe('independent reservation reminder delivery', () => {
  it('keeps the accepted Manager flag when Staff delivery fails, then retries Staff alone', async () => {
    const flags = new Set<string>();
    const contracts = {
      reservationsToRemind: jest.fn().mockResolvedValue([candidate]),
      lockById: jest.fn().mockResolvedValue({ status: 'APPROVED' }),
      hasReminder: jest.fn((_id: string, _tx: unknown, reason: string = RESERVATION_REMINDED) =>
        Promise.resolve(flags.has(reason)),
      ),
      flagReminded: jest.fn(
        (_id: string, _at: Date, _tx: unknown, reason: string = RESERVATION_REMINDED) => {
          flags.add(reason);
          return Promise.resolve();
        },
      ),
    };
    const organizations = { emailContact: jest.fn().mockResolvedValue(true) };
    const staff = { send: jest.fn().mockResolvedValueOnce(false).mockResolvedValue(true) };
    const transaction = jest.fn((work: (tx: Prisma.TransactionClient) => unknown) => work(TX));
    const job = new ReservationRemindersJob(
      contracts as unknown as ContractsRepository,
      organizations as unknown as OrganizationsService,
      { transaction } as unknown as TransactionalEvents,
      staff,
    );
    await expect(job.run(AT)).resolves.toBe(1);
    expect(flags).toEqual(new Set([RESERVATION_REMINDED]));
    await expect(job.run(AT)).resolves.toBe(0);
    expect(flags).toEqual(new Set([RESERVATION_REMINDED, RESERVATION_STAFF_REMINDED]));
    await job.run(AT);
    expect(organizations.emailContact).toHaveBeenCalledTimes(1);
    expect(staff.send).toHaveBeenCalledTimes(2);
    expect(staff.send).toHaveBeenCalledWith(
      expect.stringContaining(candidate.code),
      expect.any(String),
      TX,
    );
    expect(transaction).toHaveBeenCalledTimes(6);
  });

  it('selects an expired contract while either audience has no accepted marker', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const repository = new ContractsRepository({ rentalContract: { findMany } } as never);
    await repository.reservationsToRemind(AT);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'APPROVED',
          reservationExpiresAt: { lte: AT },
          OR: [
            { transitions: { none: { reason: RESERVATION_REMINDED } } },
            { transitions: { none: { reason: RESERVATION_STAFF_REMINDED } } },
          ],
        },
      }),
    );
  });
});
