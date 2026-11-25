import { Injectable, Logger, OnApplicationBootstrap, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob, CronTime } from 'cron';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ValidatedEnvironment } from '../config/environment-variables';
import { runAsBackgroundWork } from '../events/background-work';
import { SCHEDULED_JOB_KEY, ScheduledJobOptions } from './scheduled-job.decorator';

export type JobOutcome = 'succeeded' | 'failed' | 'skipped';

// Upper bound for one run; the lock's transaction stays open while the job works.
export const JOB_MAX_DURATION_MS = 10 * 60 * 1000;

// A request-driven tick starts at most this often per instance (D-090 rule 1).
export const JOB_TICK_INTERVAL_MS = 60 * 1000;

export type TickOutcome = JobOutcome | 'notDue';

// The timer runs of the jobs start spread over this window after their cron fire time (review of
// treklink-web#537). Every cron here fires on a whole second, so offsets that differ inside one second
// never start two jobs at the same instant, and an offset below one second stays inside the period of
// every job. Without it nine jobs started at second 0 together, each held a pooled connection for its
// lock while its handler waited for another, and the alert delivery jobs failed after the 2 s start wait.
export const JOB_START_SPREAD_MS = 1_000;

// One stable start offset per job, distinct while there are at most JOB_START_SPREAD_MS jobs. Jobs are
// ordered by how often they fire, most often first, then by name, and spread evenly over the window, so
// the alert delivery jobs (every 2 s) start first. Measured in a probe with stand-in handlers of 600 ms
// and 2.5 s: the alert jobs ran at pools of 3 and 5, but staleResponses, expirePayments and
// closeAfterReopenWindow still failed at pool 3, and requestHoldExpiry at pool 5 with 2.5 s handlers. The
// spread does not guarantee that a slower job never fails on a small pool. The order does not depend on
// the order of registration, so every replica and every restart computes the same offsets.
export const jobStartOffsets = (
  jobs: ReadonlyArray<{ name: string; cron: string }>,
): Map<string, number> => {
  const ordered = jobs
    .map(({ name, cron }) => ({ name, period: cronPeriodMs(cron) }))
    .sort((a, b) => a.period - b.period || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return new Map(
    ordered.map(({ name }, index) => [
      name,
      Math.floor((index * JOB_START_SPREAD_MS) / ordered.length),
    ]),
  );
};

// The gap between two consecutive fire times, from a fixed reference so the result never changes.
const CRON_PERIOD_REFERENCE = new Date(Date.UTC(2026, 0, 1));
const cronPeriodMs = (cron: string): number => {
  const time = new CronTime(cron);
  const first = time.getNextDateFrom(CRON_PERIOD_REFERENCE);
  return time.getNextDateFrom(first).toMillis() - first.toMillis();
};

// Hosts every @ScheduledJob (specs/platform/design.md §4.6, REQ-EVT-05). A run takes
// pg_try_advisory_xact_lock(hashtext(name)) in its own interactive transaction, so a second
// replica, or an overlapping tick of the same replica, skips instead of double-running. The
// transaction-scoped lock is used because Prisma pools connections: a session lock taken on one
// connection could be released on another. The job's own queries run outside that transaction.
@Injectable()
export class JobRunnerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(JobRunnerService.name);
  private readonly jobs = new Map<string, { cron: string; handler: () => unknown }>();
  private lastTickAt = Number.NEGATIVE_INFINITY;
  private offsets: Map<string, number> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
    private readonly registry: SchedulerRegistry,
    @Optional() private readonly config?: ConfigService<ValidatedEnvironment, true>,
  ) {}

  // With JOBS_TICK_ON_REQUEST the request-driven tick is the only runner: an in-process timer fired on a
  // thawed Vercel instance and frozen with its response would hold the job's advisory-lock transaction
  // open and make every tick skip that job (2026-11-01). Every other host keeps the timers.
  private get timersEnabled(): boolean {
    return this.config?.get('JOBS_TICK_ON_REQUEST', { infer: true }) !== true;
  }

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
    this.jobs.set(name, { cron, handler });
    this.offsets = null;
    const job = CronJob.from({
      cronTime: cron,
      onTick: () => this.startAfterOffset(name, handler),
      start: false,
    });
    this.registry.addCronJob(name, job);
    if (this.timersEnabled) job.start();
    this.logger.log(
      `Scheduled job ${name} registered on "${cron}"${this.timersEnabled ? '' : ', run by the request tick only'}`,
    );
  }

  // The start offset of a timer run (JOB_START_SPREAD_MS), computed once all jobs are registered.
  startOffset(name: string): number {
    this.offsets ??= jobStartOffsets(
      [...this.jobs].map(([jobName, { cron }]) => ({ name: jobName, cron })),
    );
    return this.offsets.get(name) ?? 0;
  }

  private startAfterOffset(name: string, handler: () => unknown): void {
    const offset = this.startOffset(name);
    if (offset === 0) {
      void this.run(name, handler);
      return;
    }
    setTimeout(() => void this.run(name, handler), offset).unref?.();
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
          // The handler's transactions keep Prisma's short start wait while this one holds a connection.
          await runAsBackgroundWork(() => handler());
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

  // The request-driven tick of design §4.6 (D-090 rule 1), for a host whose instances sleep between
  // requests, where the in-process timers above fire only while one happens to be awake. Runs, one after
  // another, every job whose cron had a fire time since its last recorded tick run (`job_runs`), or that
  // has none, through run() and its advisory lock, so two instances never run one job at once. A run that
  // took the lock is recorded, failed or not; a skipped one is left for the instance that holds the lock.
  async tick(now: Date = new Date()): Promise<Record<string, TickOutcome>> {
    const records = await this.prisma.jobRun.findMany();
    const lastRun = new Map(records.map((record) => [record.name, record.lastRunAt]));
    const outcomes: Record<string, TickOutcome> = {};
    // Longest-waiting first (never run, then the oldest run): a tick cut short when its instance is
    // frozen leaves the rest for the next tick instead of starving the same late jobs every time.
    const waited = (name: string) => lastRun.get(name)?.getTime() ?? Number.NEGATIVE_INFINITY;
    const order = [...this.jobs].sort(([a], [b]) => waited(a) - waited(b));
    for (const [name, { cron, handler }] of order) {
      const previous = lastRun.get(name);
      if (previous && new CronTime(cron).getNextDateFrom(previous).toJSDate() > now) {
        outcomes[name] = 'notDue';
        continue;
      }
      const outcome = await this.run(name, handler);
      outcomes[name] = outcome;
      if (outcome !== 'skipped') {
        await this.prisma.jobRun.upsert({
          where: { name },
          create: { name, lastRunAt: now },
          update: { lastRunAt: now },
        });
      }
    }
    return outcomes;
  }

  // At most one tick per JOB_TICK_INTERVAL_MS on this instance; null when one ran too recently. The
  // returned promise never rejects.
  tickIfDue(now: number = Date.now()): Promise<void> | null {
    if (now - this.lastTickAt < JOB_TICK_INTERVAL_MS) return null;
    this.lastTickAt = now;
    return this.tick(new Date(now)).then(
      (outcomes) => {
        const ran = Object.entries(outcomes).filter(([, outcome]) => outcome !== 'notDue');
        this.logger.log(
          `Job tick ran ${ran.map(([name, o]) => `${name}=${o}`).join(', ') || 'nothing'}`,
        );
      },
      (error: unknown) =>
        this.logger.error(
          `Job tick failed: ${error instanceof Error ? error.stack : String(error)}`,
        ),
    );
  }
}
