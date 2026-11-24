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
  describe('response and close timer races', () => {
    it.each([
      ['staleResponses', 'ACKNOWLEDGED', 'ESCALATED', 'STALE_LIMIT', TIERS],
      ['closeAfterReopenWindow', 'RESOLVED', 'CLOSED', 'REOPEN_WINDOW_ENDED', NOBODY],
    ] as const)(
      '%s skips a raced row and processes the next one in its own transaction',
      async (method, state, target, code, recipients) => {
        const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
        try {
          incidents.dueTimers.mockResolvedValue([
            { id: 'raced', state, organizationId: 'org-a' },
            { id: 'next', state, organizationId: 'org-a' },
          ]);
          lifecycle.apply.mockRejectedValueOnce(
            new DomainException(HttpStatus.CONFLICT, ErrorCode.STALE_VERSION, 'raced'),
          );
          await expect(job[method]()).resolves.toBe(1);
          expect(lifecycle.apply).toHaveBeenCalledTimes(2);
          expect(lifecycle.apply).toHaveBeenLastCalledWith(
            'next',
            state,
            target,
            { kind: 'SYSTEM' },
            expect.objectContaining({ code, recipients }),
            tx,
          );
          expect(logged).not.toHaveBeenCalled();
        } finally {
          logged.mockRestore();
        }
      },
    );
  });
});

describe('W43 targeted demo escalation', () => {
  const actor = { id: 'actual-admin', roles: ['ADMIN'], organizationId: null };
  const now = new Date('2026-11-07T08:00:00Z');
  const build = (override = {}) => {
    const current = {
      id: 'i',
      state: 'NOTIFY_PRIMARY',
      version: 2,
      organizationId: 'org',
      simulated: true,
      tierDeadlineAt: new Date(now.getTime() + 120000),
      ...override,
    };
    const incidents = {
      lockById: jest.fn().mockResolvedValue(current),
      compareAndSet: jest.fn().mockResolvedValue({ ...current, version: 3, tierDeadlineAt: now }),
    };
    const lifecycle = {
      apply: jest.fn().mockResolvedValue({ ...current, state: 'NOTIFY_BACKUP', version: 4 }),
    };
    const routing = { recipientsOf: jest.fn().mockResolvedValue(TIERS) };
    const events = {
      transaction: jest.fn((work: (tx: object) => Promise<unknown>) => work(tx)),
      emitAfterCommit: jest.fn(),
    };
    return {
      incidents,
      lifecycle,
      events,
      job: new IncidentTimersJob(
        incidents as unknown as IncidentsRepository,
        lifecycle as unknown as IncidentLifecycle,
        routing as unknown as RoutingService,
        events as unknown as TransactionalEvents,
      ),
    };
  };
  it('runs normal routing/lifecycle in one transaction, with the actual Admin in the audit', async () => {
    const f = build();
    await f.job.advanceDemo('i', 2, actor, now);
    expect(f.incidents.compareAndSet).toHaveBeenCalledWith(
      expect.objectContaining({ version: 2 }),
      { tierDeadlineAt: now },
      tx,
    );
    expect(f.lifecycle.apply).toHaveBeenCalledWith(
      'i',
      'NOTIFY_PRIMARY',
      'NOTIFY_BACKUP',
      { kind: 'SYSTEM' },
      expect.objectContaining({ code: 'TIER_TIMEOUT', expectedVersion: 3, recipients: TIERS }),
      tx,
    );
    expect(f.events.emitAfterCommit).toHaveBeenCalledWith(
      'audit.record',
      expect.objectContaining({ actorId: actor.id, action: 'demo.incident.advance' }),
    );
  });
  it.each([{ simulated: false }, { state: 'ACKNOWLEDGED' }, { state: 'CLOSED' }])(
    'rejects ineligible incident %j without changing its deadline',
    async (override) => {
      const f = build(override);
      await expect(f.job.advanceDemo('i', 2, actor, now)).rejects.toMatchObject({
        errorCode: 'INVALID_STATE_TRANSITION',
      });
      expect(f.incidents.compareAndSet).not.toHaveBeenCalled();
    },
  );
  it('rejects a deadline write that lost a race and does not apply the tier timeout', async () => {
    const f = build();
    f.incidents.compareAndSet.mockResolvedValueOnce(null);
    await expect(f.job.advanceDemo('i', 2, actor, now)).rejects.toMatchObject({
      errorCode: 'STALE_VERSION',
    });
    expect(f.lifecycle.apply).not.toHaveBeenCalled();
    expect(f.events.emitAfterCommit).not.toHaveBeenCalled();
  });
  it('rejects stale and unknown incidents before writes', async () => {
    const f = build();
    await expect(f.job.advanceDemo('i', 1, actor)).rejects.toMatchObject({
      errorCode: 'STALE_VERSION',
    });
    expect(f.incidents.compareAndSet).not.toHaveBeenCalled();
    f.incidents.lockById.mockResolvedValueOnce(null);
    await expect(f.job.advanceDemo('i', 2, actor)).rejects.toMatchObject({
      errorCode: 'NOT_FOUND',
    });
  });
});

describe('IncidentTimersJob.closeDemo (demo panel, D-110)', () => {
  const now = new Date('2026-11-24T08:00:00Z');
  const tx = { tx: true };
  const build = (override = {}) => {
    const current = { id: 'i', code: 'INC-1', state: 'RESOLVED', version: 5, ...override };
    const incidents = {
      lockById: jest.fn().mockResolvedValue(current),
      compareAndSet: jest
        .fn()
        .mockResolvedValue({ ...current, version: 6, reopenWindowEndsAt: now }),
    };
    const lifecycle = {
      apply: jest.fn().mockResolvedValue({ ...current, state: 'CLOSED', version: 7 }),
    };
    const events = {
      transaction: jest.fn((work: (t: object) => Promise<unknown>) => work(tx)),
      emitAfterCommit: jest.fn(),
    };
    const job = new IncidentTimersJob(
      incidents as unknown as IncidentsRepository,
      lifecycle as unknown as IncidentLifecycle,
      { recipientsOf: jest.fn() } as unknown as RoutingService,
      events as unknown as TransactionalEvents,
    );
    return { job, incidents, lifecycle };
  };

  it.each(['RESOLVED', 'FALSE_ALARM'])(
    'ends the reopen window of a %s incident and closes it as SYSTEM',
    async (state) => {
      const f = build({ state });
      await expect(f.job.closeDemo('i', 5, now)).resolves.toMatchObject({ state: 'CLOSED' });
      expect(f.incidents.compareAndSet).toHaveBeenCalledWith(
        expect.objectContaining({ version: 5 }),
        { reopenWindowEndsAt: now },
        tx,
      );
      expect(f.lifecycle.apply).toHaveBeenCalledWith(
        'i',
        state,
        'CLOSED',
        { kind: 'SYSTEM' },
        expect.objectContaining({ code: 'REOPEN_WINDOW_ENDED', at: now, expectedVersion: 6 }),
        tx,
      );
    },
  );

  it.each(['NOTIFY_PRIMARY', 'ACKNOWLEDGED', 'CLOSED'])(
    'refuses a %s incident before any write',
    async (state) => {
      const f = build({ state });
      await expect(f.job.closeDemo('i', 5, now)).rejects.toMatchObject({
        errorCode: 'INVALID_STATE_TRANSITION',
      });
      expect(f.incidents.compareAndSet).not.toHaveBeenCalled();
    },
  );

  it('refuses a stale version, a lost race and an unknown incident', async () => {
    const f = build();
    await expect(f.job.closeDemo('i', 4, now)).rejects.toMatchObject({
      errorCode: 'STALE_VERSION',
    });
    f.incidents.compareAndSet.mockResolvedValueOnce(null);
    await expect(f.job.closeDemo('i', 5, now)).rejects.toMatchObject({
      errorCode: 'STALE_VERSION',
    });
    expect(f.lifecycle.apply).not.toHaveBeenCalled();
    f.incidents.lockById.mockResolvedValueOnce(null);
    await expect(f.job.closeDemo('i', 5, now)).rejects.toMatchObject({ errorCode: 'NOT_FOUND' });
  });
});
