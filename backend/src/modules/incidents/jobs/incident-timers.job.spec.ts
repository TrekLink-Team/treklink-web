import { HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainException, ErrorCode } from '../../../common/errors';
import { TransactionalEvents } from '../../platform/events/emit-after-commit';
import { SCHEDULED_JOB_KEY } from '../../platform/scheduler/scheduled-job.decorator';
import { IncidentLifecycle } from '../incident-lifecycle';
import { IncidentsRepository } from '../incidents.repository';
import { RoutingService } from '../routing.service';
import { IncidentTimersJob, TIMER_BATCH } from './incident-timers.job';

const tx = { tx: true } as unknown as Prisma.TransactionClient;
const TIERS = { primary: ['p'], backup: ['b'], managers: ['m'], staff: [] };
const NOBODY = { primary: [], backup: [], managers: [], staff: [] };

describe('IncidentTimersJob (incidents 3.1)', () => {
  let incidents: { dueTimers: jest.Mock };
  let lifecycle: { apply: jest.Mock };
  let routing: { recipientsOf: jest.Mock };
  let job: IncidentTimersJob;

  beforeEach(() => {
    incidents = { dueTimers: jest.fn().mockResolvedValue([]) };
    lifecycle = { apply: jest.fn().mockResolvedValue({}) };
    routing = {
      recipientsOf: jest.fn((organizationId: string | null) =>
        Promise.resolve(organizationId ? TIERS : NOBODY),
      ),
    };
    const events = {
      transaction: jest.fn((work: (client: Prisma.TransactionClient) => Promise<unknown>) =>
        work(tx),
      ),
    };
    job = new IncidentTimersJob(
      incidents as unknown as IncidentsRepository,
      lifecycle as unknown as IncidentLifecycle,
      routing as unknown as RoutingService,
      events as unknown as TransactionalEvents,
    );
  });

  it('registers the three jobs of design §6 on their tick', () => {
    const schedule = (method: string) =>
      Reflect.getMetadata(
        SCHEDULED_JOB_KEY,
        Object.getOwnPropertyDescriptor(IncidentTimersJob.prototype, method)!.value as object,
      ) as unknown;
    expect(schedule('tierTimeouts')).toEqual({
      name: 'incidents.tierTimeouts',
      cron: '*/5 * * * * *',
    });
    expect(schedule('staleResponses')).toEqual({
      name: 'incidents.staleResponses',
      cron: '*/30 * * * * *',
    });
    expect(schedule('closeAfterReopenWindow')).toEqual({
      name: 'incidents.closeAfterReopenWindow',
      cron: '0 * * * * *',
    });
  });

  it('moves each timed-out tier to the next one as SYSTEM, with the tiers of its organization', async () => {
    incidents.dueTimers.mockResolvedValue([
      { id: 'i-1', state: 'NOTIFY_PRIMARY', organizationId: 'org-a' },
      { id: 'i-2', state: 'NOTIFY_BACKUP', organizationId: 'org-a' },
      { id: 'i-3', state: 'NOTIFY_MANAGER', organizationId: 'org-b' },
    ]);
    await expect(job.tierTimeouts()).resolves.toBe(3);
    const [states, column, now, take] = incidents.dueTimers.mock.calls[0] as [
      string[],
      string,
      Date,
      number,
    ];
    expect([states, column, take]).toEqual([
      ['NOTIFY_PRIMARY', 'NOTIFY_BACKUP', 'NOTIFY_MANAGER'],
      'tierDeadlineAt',
      TIMER_BATCH,
    ]);
    const reason = { code: 'TIER_TIMEOUT', at: now, recipients: TIERS };
    expect(lifecycle.apply.mock.calls).toEqual([
      ['i-1', 'NOTIFY_PRIMARY', 'NOTIFY_BACKUP', { kind: 'SYSTEM' }, reason, tx],
      ['i-2', 'NOTIFY_BACKUP', 'NOTIFY_MANAGER', { kind: 'SYSTEM' }, reason, tx],
      ['i-3', 'NOTIFY_MANAGER', 'ESCALATED', { kind: 'SYSTEM' }, reason, tx],
    ]);
    expect(routing.recipientsOf).toHaveBeenCalledWith('org-b', now, tx);
  });

  it('escalates an owned incident past its status deadline (REQ-EVT-07)', async () => {
    incidents.dueTimers.mockResolvedValue([
      { id: 'i-1', state: 'ACKNOWLEDGED', organizationId: 'org-a' },
      { id: 'i-2', state: 'RESPONDING', organizationId: 'org-a' },
    ]);
    await expect(job.staleResponses()).resolves.toBe(2);
    expect((incidents.dueTimers.mock.calls[0] as unknown[]).slice(0, 2)).toEqual([
      ['ACKNOWLEDGED', 'RESPONDING'],
      'statusDueAt',
    ]);
    expect(lifecycle.apply.mock.calls.map((call: unknown[]) => [call[1], call[2]])).toEqual([
      ['ACKNOWLEDGED', 'ESCALATED'],
      ['RESPONDING', 'ESCALATED'],
    ]);
    expect(lifecycle.apply).toHaveBeenCalledWith(
      'i-1',
      'ACKNOWLEDGED',
      'ESCALATED',
      { kind: 'SYSTEM' },
      expect.objectContaining({ code: 'STALE_LIMIT', recipients: TIERS }),
      tx,
    );
  });

  it('closes ended episodes past the window and alerts no tier (REQ-EVT-10)', async () => {
    incidents.dueTimers.mockResolvedValue([
      { id: 'i-1', state: 'RESOLVED', organizationId: 'org-a' },
      { id: 'i-2', state: 'FALSE_ALARM', organizationId: null },
    ]);
    await expect(job.closeAfterReopenWindow()).resolves.toBe(2);
    expect((incidents.dueTimers.mock.calls[0] as unknown[]).slice(0, 2)).toEqual([
      ['RESOLVED', 'FALSE_ALARM'],
      'reopenWindowEndsAt',
    ]);
    expect(routing.recipientsOf.mock.calls.map((call: unknown[]) => call[0])).toEqual([null, null]);
    expect(lifecycle.apply.mock.calls.map((call: unknown[]) => [call[2], call[4]])).toEqual([
      ['CLOSED', expect.objectContaining({ code: 'REOPEN_WINDOW_ENDED', recipients: NOBODY })],
      ['CLOSED', expect.objectContaining({ code: 'REOPEN_WINDOW_ENDED', recipients: NOBODY })],
    ]);
  });

  it('does nothing when no deadline has passed', async () => {
    await expect(job.tierTimeouts()).resolves.toBe(0);
    expect(lifecycle.apply).not.toHaveBeenCalled();
  });

  it.each([
    [ErrorCode.STALE_VERSION, HttpStatus.CONFLICT],
    [ErrorCode.INVALID_STATE_TRANSITION, HttpStatus.CONFLICT],
  ])('skips an incident a human action moved first (%s), and goes on', async (code, status) => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    incidents.dueTimers.mockResolvedValue([
      { id: 'i-1', state: 'NOTIFY_PRIMARY', organizationId: 'org-a' },
      { id: 'i-2', state: 'NOTIFY_PRIMARY', organizationId: 'org-a' },
    ]);
    lifecycle.apply.mockRejectedValueOnce(new DomainException(status, code, 'raced'));
    await expect(job.tierTimeouts()).resolves.toBe(1);
    expect(lifecycle.apply).toHaveBeenCalledTimes(2);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('logs any other failure and still moves the rest; that incident is due again next tick', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    incidents.dueTimers.mockResolvedValue([
      { id: 'i-1', state: 'NOTIFY_PRIMARY', organizationId: 'org-a' },
      { id: 'i-2', state: 'NOTIFY_PRIMARY', organizationId: 'org-a' },
      { id: 'i-3', state: 'NOTIFY_PRIMARY', organizationId: 'org-a' },
    ]);
    lifecycle.apply
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockRejectedValueOnce('not an error');
    await expect(job.tierTimeouts()).resolves.toBe(1);
    expect(error).toHaveBeenNthCalledWith(
      1,
      'TIER_TIMEOUT on incident i-1 failed: connection lost',
    );
    expect(error).toHaveBeenNthCalledWith(2, 'TIER_TIMEOUT on incident i-2 failed: not an error');
    error.mockRestore();
  });
});
