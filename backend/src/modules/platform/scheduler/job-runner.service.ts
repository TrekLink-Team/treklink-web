import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { SCHEDULED_JOB_KEY, ScheduledJobOptions } from './scheduled-job.decorator';

export type JobOutcome = 'succeeded' | 'failed' | 'skipped';

// Upper bound for one run; the lock's transaction stays open while the job works.
export const JOB_MAX_DURATION_MS = 10 * 60 * 1000;

// Hosts every @ScheduledJob (specs/platform/design.md §4.6, REQ-EVT-05). A run takes
// pg_try_advisory_xact_lock(hashtext(name)) in its own interactive transaction, so a second
// replica, or an overlapping tick of the same replica, skips instead of double-running. The
// transaction-scoped lock is used because Prisma pools connections: a session lock taken on one
// connection could be released on another. The job's own queries run outside that transaction.
@Injectable()
export class JobRunnerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(JobRunnerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
    private readonly registry: SchedulerRegistry,
  ) {}

  onApplicationBootstrap(): void {
    for (const wrapper of this.discovery.getProviders()) {
      const instance: unknown = wrapper.instance;
      if (!instance || typeof instance !== 'object') continue;
      const prototype = Object.getPrototypeOf(instance) as object;
      for (const methodName of this.scanner.getAllMethodNames(prototype)) {
        const method = (instance as Record<string, unknown>)[methodName];
        if (typeof method !== 'function') continue;
        const options = this.reflector.get<ScheduledJobOptions | undefined>(
          SCHEDULED_JOB_KEY,
          method,
        );
        if (!options) continue;
        const handler = () => (method as () => unknown).call(instance);
        this.register(options, handler);
      }
    }
  }

  register({ name, cron }: ScheduledJobOptions, handler: () => unknown): void {
    const job = CronJob.from({
      cronTime: cron,
      onTick: () => void this.run(name, handler),
      start: false,
    });
    this.registry.addCronJob(name, job);
    job.start();
    this.logger.log(`Scheduled job ${name} registered on "${cron}"`);
  }

  // Never rejects: one failed job must not stop the scheduler or another job.
  async run(name: string, handler: () => unknown): Promise<JobOutcome> {
    const startedAt = Date.now();
    let outcome: JobOutcome = 'skipped';
    try {
      await this.prisma.$transaction(
        async (tx) => {
          const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`
            SELECT pg_try_advisory_xact_lock(hashtext(${name})) AS "locked"`;
          if (!lock?.locked) return;

          this.logger.log(`Job ${name} started`);
          outcome = 'failed';
          await handler();
          outcome = 'succeeded';
        },
        { timeout: JOB_MAX_DURATION_MS },
      );
    } catch (error) {
      outcome = 'failed';
      this.logger.error(
        `Job ${name} failed after ${Date.now() - startedAt} ms: ${
          error instanceof Error ? error.stack : String(error)
        }`,
      );
      return outcome;
    }

    if (outcome === 'skipped') this.logger.debug(`Job ${name} skipped: lock held elsewhere`);
    else this.logger.log(`Job ${name} succeeded in ${Date.now() - startedAt} ms`);
    return outcome;
  }
}
