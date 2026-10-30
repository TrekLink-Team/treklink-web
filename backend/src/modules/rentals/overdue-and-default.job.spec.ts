import { ContractStatus, Prisma } from '@prisma/client';
import { OrganizationsService } from '../organizations';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
import { ContractLifecycleService } from './contract-lifecycle.service';
import { ContractsRepository } from './contracts.repository';
import { OverdueAndDefaultJob } from './overdue-and-default.job';
import { ReservationRemindersJob } from './reservation-reminders.job';

const TX = {} as Prisma.TransactionClient;
// The fake clock of AC-04 and AC-05: grace 24 h, default after 7 days.
const AT = new Date('2026-11-30T03:00:00.000Z');
const HOUR_MS = 3_600_000;

const events = {
  transaction: (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => work(TX),
} as unknown as TransactionalEvents;

describe('OverdueAndDefaultJob (rentals 3.2, REQ-EVT-13, AC-04, AC-05)', () => {
  let contracts: Record<string, jest.Mock>;
  let lifecycle: { apply: jest.Mock };
  let organizations: { suspendForDefault: jest.Mock };
  let job: OverdueAndDefaultJob;
  let parameters: { get: jest.Mock };

  beforeEach(() => {
    contracts = {
      returnDueBefore: jest.fn().mockResolvedValue([]),
      overdueBefore: jest.fn().mockResolvedValue([]),
      lockById: jest.fn().mockImplementation((id: string) =>
        Promise.resolve({
          id,
          code: `RC-${id}`,
          organizationId: 'org-1',
          status: id.startsWith('due') ? ContractStatus.RETURN_DUE : ContractStatus.OVERDUE,
        }),
      ),
      rowsOut: jest.fn().mockResolvedValue([{ id: 'cd-1', deviceId: 'd-1' }]),
      stampOverdue: jest.fn().mockResolvedValue(undefined),
    };
    lifecycle = { apply: jest.fn().mockResolvedValue({}) };
    organizations = { suspendForDefault: jest.fn().mockResolvedValue(true) };
    parameters = {
      get: jest
        .fn()
        .mockImplementation((key: string) =>
          Promise.resolve(
            key === 'rentals.returnGraceHours'
              ? 24
              : key === 'rentals.termRolloverHourLocal'
                ? 9
                : 7,
          ),
        ),
    };
    job = new OverdueAndDefaultJob(
      contracts as unknown as ContractsRepository,
      lifecycle as unknown as ContractLifecycleService,
      organizations as unknown as OrganizationsService,
      parameters as unknown as ParameterService,
      events,
    );
  });

  it('bases the grace and default thresholds on the most recent daily cutoff', async () => {
    await job.run(AT);
    const cutoff = new Date('2026-11-30T02:00:00Z');
    expect(contracts.returnDueBefore).toHaveBeenCalledWith(
      new Date(cutoff.getTime() - 24 * HOUR_MS),
    );
    expect(contracts.overdueBefore).toHaveBeenCalledWith(
      new Date(cutoff.getTime() - 7 * 24 * HOUR_MS),
    );
  });

  it('catches up the previous daily batch before the configured hour', async () => {
    await job.run(new Date('2026-11-30T01:59:59Z'));
    expect(contracts.returnDueBefore).toHaveBeenCalledWith(new Date('2026-11-28T02:00:00Z'));
    expect(contracts.overdueBefore).toHaveBeenCalledWith(new Date('2026-11-22T02:00:00Z'));
  });

  it('uses a changed configured hour without changing the actual event instant', async () => {
    parameters.get.mockImplementation((key: string) =>
      Promise.resolve(
        key === 'rentals.returnGraceHours' ? 24 : key === 'rentals.termRolloverHourLocal' ? 11 : 7,
      ),
    );
    contracts.returnDueBefore.mockResolvedValue([{ id: 'due-1' }]);
    await job.run(AT);
    expect(contracts.returnDueBefore).toHaveBeenCalledWith(new Date('2026-11-28T04:00:00Z'));
    expect(contracts.stampOverdue).toHaveBeenCalledWith('due-1', { overdueAt: AT }, TX);
  });

  it('moves a RETURN_DUE contract with devices out to OVERDUE by SYSTEM (AC-04)', async () => {
    contracts.returnDueBefore.mockResolvedValue([{ id: 'due-1' }]);
    await expect(job.run(AT)).resolves.toEqual({ overdue: 1, defaulted: 0, suspended: 0 });
    expect(lifecycle.apply).toHaveBeenCalledWith(
      'due-1',
      ContractStatus.RETURN_DUE,
      ContractStatus.OVERDUE,
      'GRACE_ELAPSED',
      null,
      TX,
    );
    expect(contracts.stampOverdue).toHaveBeenCalledWith('due-1', { overdueAt: AT }, TX);
  });

  it('leaves a RETURN_DUE contract with nothing out', async () => {
    contracts.returnDueBefore.mockResolvedValue([{ id: 'due-1' }]);
    contracts.rowsOut.mockResolvedValue([]);
    await expect(job.run(AT)).resolves.toEqual({ overdue: 0, defaulted: 0, suspended: 0 });
    expect(lifecycle.apply).not.toHaveBeenCalled();
  });

  it('moves an OVERDUE contract to DEFAULTED and suspends the organization (AC-05)', async () => {
    contracts.overdueBefore.mockResolvedValue([{ id: 'late-1' }]);
    await expect(job.run(AT)).resolves.toEqual({ overdue: 0, defaulted: 1, suspended: 1 });
    expect(lifecycle.apply).toHaveBeenCalledWith(
      'late-1',
      ContractStatus.OVERDUE,
      ContractStatus.DEFAULTED,
      'DEFAULT_THRESHOLD',
      null,
      TX,
    );
    expect(contracts.stampOverdue).toHaveBeenCalledWith('late-1', { defaultedAt: AT }, TX);
    expect(organizations.suspendForDefault).toHaveBeenCalledWith('org-1', 'RC-late-1', AT, TX);
  });

  it('counts a default whose organization was already suspended without suspending again', async () => {
    contracts.overdueBefore.mockResolvedValue([{ id: 'late-1' }, { id: 'late-2' }]);
    organizations.suspendForDefault.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(job.run(AT)).resolves.toEqual({ overdue: 0, defaulted: 2, suspended: 1 });
  });

  it('moves nothing on a re-run, when the contract already left the state it was found in', async () => {
    contracts.returnDueBefore.mockResolvedValue([{ id: 'due-1' }]);
    contracts.overdueBefore.mockResolvedValue([{ id: 'late-1' }]);
    contracts.lockById.mockResolvedValue({ status: ContractStatus.RETURNED });
    await expect(job.run(AT)).resolves.toEqual({ overdue: 0, defaulted: 0, suspended: 0 });
    expect(lifecycle.apply).not.toHaveBeenCalled();
    expect(organizations.suspendForDefault).not.toHaveBeenCalled();
  });
});

describe('ReservationRemindersJob (rentals 3.2, REQ-EVT-14)', () => {
  let contracts: Record<string, jest.Mock>;
  let organizations: { emailContact: jest.Mock };
  let job: ReservationRemindersJob;
  const EXPIRED = new Date('2026-11-29T02:00:00.000Z');
  const CANDIDATE = {
    id: 'c-1',
    code: 'RC-2026-0003',
    organizationId: 'org-1',
    reservationExpiresAt: EXPIRED,
  };

  beforeEach(() => {
    contracts = {
      reservationsToRemind: jest.fn().mockResolvedValue([CANDIDATE]),
      lockById: jest.fn().mockResolvedValue({ status: ContractStatus.APPROVED }),
      hasReminder: jest.fn().mockResolvedValue(false),
      flagReminded: jest.fn().mockResolvedValue(undefined),
    };
    organizations = { emailContact: jest.fn().mockResolvedValue(true) };
    job = new ReservationRemindersJob(
      contracts as unknown as ContractsRepository,
      organizations as unknown as OrganizationsService,
      events,
    );
  });

  it('emails the Manager under the contract lock, then flags the reminder', async () => {
    await expect(job.run(AT)).resolves.toBe(1);
    // No Staff notifications here, so the query leaves out the Staff part.
    expect(contracts.reservationsToRemind).toHaveBeenCalledWith(AT, false);
    expect(contracts.hasReminder).toHaveBeenCalledWith('c-1', TX);
    expect(organizations.emailContact).toHaveBeenCalledWith(
      'org-1',
      'TrekLink contract RC-2026-0003: reservation expired',
      expect.stringContaining('29 Nov 2026'),
      TX,
    );
    expect(contracts.flagReminded).toHaveBeenCalledWith('c-1', AT, TX);
    expect(organizations.emailContact.mock.invocationCallOrder[0]).toBeLessThan(
      contracts.flagReminded.mock.invocationCallOrder[0],
    );
  });

  it('reminds once when two runs picked the same contract: the second sees the flag under the lock', async () => {
    // Both runs read the candidate before either committed; the lock serializes them.
    contracts.hasReminder.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const [first, second] = await Promise.all([job.run(AT), job.run(AT)]);
    expect(first + second).toBe(1);
    expect(organizations.emailContact).toHaveBeenCalledTimes(1);
    expect(contracts.flagReminded).toHaveBeenCalledTimes(1);
  });

  it('leaves the reminder unflagged when the email is not delivered, and retries on the next run', async () => {
    organizations.emailContact.mockResolvedValueOnce(false);
    await expect(job.run(AT)).resolves.toBe(0);
    expect(contracts.flagReminded).not.toHaveBeenCalled();

    await expect(job.run(AT)).resolves.toBe(1);
    expect(organizations.emailContact).toHaveBeenCalledTimes(2);
    expect(contracts.flagReminded).toHaveBeenCalledTimes(1);
  });

  it('reminds nothing when the query finds no unreminded contract', async () => {
    contracts.reservationsToRemind.mockResolvedValue([]);
    await expect(job.run(AT)).resolves.toBe(0);
    expect(organizations.emailContact).not.toHaveBeenCalled();
  });

  it('skips a contract handed over or cancelled since the query', async () => {
    contracts.lockById.mockResolvedValue({ status: ContractStatus.ACTIVE });
    await expect(job.run(AT)).resolves.toBe(0);
    expect(organizations.emailContact).not.toHaveBeenCalled();
    expect(contracts.flagReminded).not.toHaveBeenCalled();
  });
});
