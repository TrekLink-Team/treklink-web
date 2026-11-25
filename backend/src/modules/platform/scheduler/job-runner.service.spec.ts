import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DiscoveryModule } from '@nestjs/core';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ScheduleModule, SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { inBackgroundWork } from '../events/background-work';
import { TransactionalEvents, TRANSACTION_MAX_WAIT_MS } from '../events/emit-after-commit';
import {
  JOB_MAX_DURATION_MS,
  JOB_START_SPREAD_MS,
  JobRunnerService,
  jobStartOffsets,
} from './job-runner.service';
import { ScheduledJob } from './scheduled-job.decorator';

@Injectable()
class SampleJobs {
  runs = 0;

  @ScheduledJob('sample.sweep', '0 0 3 * * *')
  sweep(): void {
    this.runs += 1;
  }
}

// `$transaction` hands the callback a client whose advisory-lock query answers `locked`; `jobRun` keeps
// the tick records in memory.
const lastRuns = new Map<string, Date>();
const prismaWithLock = (locked: () => boolean) => ({
  $transaction: jest.fn((work: (tx: object) => Promise<unknown>) =>
    work({ $queryRaw: jest.fn(() => Promise.resolve([{ locked: locked() }])) }),
  ),
  jobRun: {
    findMany: jest.fn(() =>
      Promise.resolve([...lastRuns].map(([name, lastRunAt]) => ({ name, lastRunAt }))),
    ),
    upsert: jest.fn(({ create }: { create: { name: string; lastRunAt: Date } }) => {
      lastRuns.set(create.name, create.lastRunAt);
      return Promise.resolve(create);
    }),
  },
});

describe('JobRunnerService', () => {
  let locked: boolean;
  let jobs: SampleJobs;
  let runner: JobRunnerService;
  let registry: SchedulerRegistry;
  let close: () => Promise<void>;
  let errorLog: jest.SpyInstance;

  beforeEach(async () => {
    locked = true;
    lastRuns.clear();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const moduleRef = await Test.createTestingModule({
      imports: [ScheduleModule.forRoot(), DiscoveryModule],
      providers: [
        JobRunnerService,
        SampleJobs,
        { provide: PrismaService, useValue: prismaWithLock(() => locked) },
      ],
    }).compile();
    await moduleRef.init();
    jobs = moduleRef.get(SampleJobs);
    runner = moduleRef.get(JobRunnerService);
    registry = moduleRef.get(SchedulerRegistry);
    close = () => moduleRef.close();
  });

  afterEach(async () => {
    await close();
    jest.restoreAllMocks();
  });

  it('registers every @ScheduledJob method under its name at bootstrap', () => {
    const job = registry.getCronJob('sample.sweep');

    expect(job.isActive).toBe(true);
    expect(job.cronTime.source).toBe('0 0 3 * * *');
  });

  it('runs the handler when it takes the lock', async () => {
    await expect(runner.run('sample.sweep', () => jobs.sweep())).resolves.toBe('succeeded');

    expect(jobs.runs).toBe(1);
  });

  // treklink-web#537: nine jobs fire together each minute, each holding a connection for its lock. A
  // long start wait in their handlers' transactions held the whole pool and every request timed out.
  it('runs the handler as background work, so its transactions keep the short start wait', async () => {
    const inner = jest.fn((work: (tx: object) => Promise<unknown>) => work({}));
    const events = new TransactionalEvents(
      { $transaction: inner } as unknown as PrismaService,
      new EventEmitter2(),
    );
    let background: boolean | undefined;

    await runner.run('sample.sweep', async () => {
      background = inBackgroundWork();
      await events.transaction(() => Promise.resolve('done'), { timeout: 5_000 });
    });

    expect(background).toBe(true);
    expect(inner).toHaveBeenCalledWith(expect.any(Function), { timeout: 5_000 });
    expect(inBackgroundWork()).toBe(false);
  });

  it('starts its own lock transaction without a long start wait', async () => {
    const prisma = (runner as unknown as { prisma: { $transaction: jest.Mock } }).prisma;

    await runner.run('sample.sweep', () => jobs.sweep());

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      timeout: JOB_MAX_DURATION_MS,
    });
    expect(TRANSACTION_MAX_WAIT_MS).toBeGreaterThan(2_000);
  });

  it('skips the run when another instance holds the lock', async () => {
    locked = false;

    await expect(runner.run('sample.sweep', () => jobs.sweep())).resolves.toBe('skipped');

    expect(jobs.runs).toBe(0);
  });

  it('logs a failed run and still fires the next one', async () => {
    let calls = 0;
    const flaky = () => {
      calls += 1;
      if (calls === 1) throw new Error('deadline query failed');
      return Promise.resolve();
    };

    await expect(runner.run('sample.flaky', flaky)).resolves.toBe('failed');
    await expect(runner.run('sample.flaky', flaky)).resolves.toBe('succeeded');

    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('deadline query failed'));
    expect(calls).toBe(2);
  });

  describe('request-driven tick (D-090 rule 1)', () => {
    // sample.sweep fires daily at 03:00:00.
    const at = (iso: string) => new Date(iso);

    it('runs a job with no recorded run and records it', async () => {
      await expect(runner.tick(at('2026-11-01T05:00:00Z'))).resolves.toEqual({
        'sample.sweep': 'succeeded',
      });
      expect(jobs.runs).toBe(1);
      expect(lastRuns.get('sample.sweep')).toEqual(at('2026-11-01T05:00:00Z'));
    });

    it('skips a job whose cron has not fired since its last run, then runs it once it has', async () => {
      lastRuns.set('sample.sweep', at('2026-11-01T03:30:00'));
      await expect(runner.tick(at('2026-11-02T02:59:59'))).resolves.toEqual({
        'sample.sweep': 'notDue',
      });
      expect(jobs.runs).toBe(0);
      await expect(runner.tick(at('2026-11-02T03:00:01'))).resolves.toEqual({
        'sample.sweep': 'succeeded',
      });
      expect(jobs.runs).toBe(1);
    });

    it('leaves the record alone when another instance holds the lock', async () => {
      locked = false;
      await expect(runner.tick(at('2026-11-01T05:00:00Z'))).resolves.toEqual({
        'sample.sweep': 'skipped',
      });
      expect(lastRuns.has('sample.sweep')).toBe(false);
    });

    it('runs the longest-waiting job first', async () => {
      const order: string[] = [];
      // Yearly, so the live timers never fire in the test; both last runs predate the last fire time.
      runner.register({ name: 'sample.recent', cron: '0 0 0 1 1 *' }, () => order.push('recent'));
      runner.register({ name: 'sample.stale', cron: '0 0 0 1 1 *' }, () => order.push('stale'));
      lastRuns.set('sample.recent', at('2025-06-01T00:00:00Z'));
      lastRuns.set('sample.stale', at('2025-02-01T00:00:00Z'));
      lastRuns.set('sample.sweep', at('2026-11-01T04:59:30Z'));
      await runner.tick(at('2026-11-01T05:00:00Z'));
      expect(order).toEqual(['stale', 'recent']);
      registry.deleteCronJob('sample.recent');
      registry.deleteCronJob('sample.stale');
    });

    it('starts at most one tick per minute on an instance', async () => {
      const first = runner.tickIfDue(1_000_000);
      expect(first).not.toBeNull();
      await first;
      expect(runner.tickIfDue(1_000_000 + 59_999)).toBeNull();
      const next = runner.tickIfDue(1_000_000 + 60_000);
      expect(next).not.toBeNull();
      await next;
    });
  });

  it('starts no timer when the request tick is the runner (JOBS_TICK_ON_REQUEST)', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ScheduleModule.forRoot(), DiscoveryModule],
      providers: [
        JobRunnerService,
        SampleJobs,
        { provide: PrismaService, useValue: prismaWithLock(() => true) },
        { provide: ConfigService, useValue: { get: () => true } },
      ],
    }).compile();
    await moduleRef.init();
    try {
      const job = moduleRef.get(SchedulerRegistry).getCronJob('sample.sweep');
      expect(job.isActive).toBe(false);
    } finally {
      await moduleRef.close();
    }
  });

  // Review of treklink-web#537: the jobs registered on dev 608e7320, by name and cron.
  const BACKEND_JOBS = [
    { name: 'monitoring.pruneStream', cron: '0 10 * * * *' },
    { name: 'monitoring.staleSweep', cron: '*/5 * * * * *' },
    { name: 'rentals.termRollover', cron: '0 5 * * * *' },
    { name: 'rentals.requestHoldExpiry', cron: '0 */10 * * * *' },
    { name: 'rentals.overdueAndDefault', cron: '0 15 * * * *' },
    { name: 'rentals.reservationReminders', cron: '0 25 * * * *' },
    { name: 'incidents.tierTimeouts', cron: '*/5 * * * * *' },
    { name: 'incidents.staleResponses', cron: '*/30 * * * * *' },
    { name: 'incidents.closeAfterReopenWindow', cron: '0 * * * * *' },
    { name: 'incidents.deliverAlerts', cron: '*/2 * * * * *' },
    { name: 'incidents.deliverEmailAlerts', cron: '*/2 * * * * *' },
    { name: 'billing.expirePayments', cron: '0 * * * * *' },
    { name: 'devices.lossSearch', cron: '0 20 * * * *' },
    { name: 'devices.dockSweep', cron: '*/10 * * * * *' },
    { name: 'devices.serviceScan', cron: '0 0 * * * *' },
    { name: 'gatewaySync.fieldSimulator', cron: '*/10 * * * * *' },
  ];
  const ALERT_JOBS = ['incidents.deliverAlerts', 'incidents.deliverEmailAlerts'];

  describe('start offsets (review of treklink-web#537)', () => {
    it('gives every job a distinct offset inside the spread window, stable across registration order', () => {
      const offsets = jobStartOffsets(BACKEND_JOBS);
      const shuffled = jobStartOffsets([...BACKEND_JOBS].reverse());

      expect(offsets.size).toBe(BACKEND_JOBS.length);
      expect(new Set(offsets.values()).size).toBe(BACKEND_JOBS.length);
      for (const offset of offsets.values()) {
        expect(offset).toBeGreaterThanOrEqual(0);
        expect(offset).toBeLessThan(JOB_START_SPREAD_MS);
      }
      expect([...shuffled].sort()).toEqual([...offsets].sort());
    });

    it('starts the alert delivery jobs first', () => {
      const offsets = jobStartOffsets(BACKEND_JOBS);
      const sorted = [...offsets].sort(([, a], [, b]) => a - b).map(([name]) => name);

      expect(sorted.slice(0, 2).sort()).toEqual(ALERT_JOBS);
    });

    it('starts no two jobs at the same instant at 03:00:00, the alert jobs before the rest', async () => {
      jest.useFakeTimers({ now: new Date('2026-11-25T02:59:59.000Z') });
      const lockStarts: { name: string; at: number }[] = [];
      const prisma = {
        $transaction: jest.fn((work: (tx: object) => Promise<unknown>) =>
          work({
            $queryRaw: jest.fn((_sql: TemplateStringsArray, name: string) => {
              lockStarts.push({ name, at: Date.now() });
              return Promise.resolve([{ locked: true }]);
            }),
          }),
        ),
      };
      const timers = new SchedulerRegistry();
      const staggered = new JobRunnerService(
        prisma as unknown as PrismaService,
        {} as never,
        {} as never,
        {} as never,
        timers,
      );
      try {
        for (const job of BACKEND_JOBS) staggered.register(job, () => undefined);
        await jest.advanceTimersByTimeAsync(1_000 + JOB_START_SPREAD_MS);

        const atSecondZero = lockStarts.filter(
          ({ at }) => at >= Date.parse('2026-11-25T03:00:00.000Z'),
        );
        // At the top of the hour every job fires except the five hourly ones set to a later minute.
        const laterMinute = [
          'devices.lossSearch',
          'monitoring.pruneStream',
          'rentals.overdueAndDefault',
          'rentals.reservationReminders',
          'rentals.termRollover',
        ];
        expect(atSecondZero.map(({ name }) => name).sort()).toEqual(
          BACKEND_JOBS.map(({ name }) => name)
            .filter((name) => !laterMinute.includes(name))
            .sort(),
        );
        expect(new Set(atSecondZero.map(({ at }) => at)).size).toBe(atSecondZero.length);
        const ordered = [...atSecondZero].sort((a, b) => a.at - b.at).map(({ name }) => name);
        expect(ordered.slice(0, 2).sort()).toEqual(ALERT_JOBS);
        for (const { name } of BACKEND_JOBS)
          expect(staggered.startOffset(name)).toBe(jobStartOffsets(BACKEND_JOBS).get(name));
      } finally {
        for (const job of timers.getCronJobs().values()) void job.stop();
        jest.useRealTimers();
      }
    });
  });
});
