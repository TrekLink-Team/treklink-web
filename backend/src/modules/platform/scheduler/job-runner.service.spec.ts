import { Injectable, Logger } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { ScheduleModule, SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { JobRunnerService } from './job-runner.service';
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
});
