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

// `$transaction` hands the callback a client whose advisory-lock query answers `locked`.
const prismaWithLock = (locked: () => boolean) => ({
  $transaction: jest.fn((work: (tx: object) => Promise<unknown>) =>
    work({ $queryRaw: jest.fn(() => Promise.resolve([{ locked: locked() }])) }),
  ),
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
});
