import { randomUUID } from 'node:crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StaleSubject } from '@prisma/client';
import { PrismaService } from '../src/common/prisma/prisma.service';
import type { DevicesService } from '../src/modules/devices';
import type { OrganizationsService } from '../src/modules/organizations';
import { TransactionalEvents } from '../src/modules/platform/events/emit-after-commit';
import type { ParameterService } from '../src/modules/platform/parameters/parameter.service';
import type { ContractsService } from '../src/modules/rentals';
import { StaleSweepJob } from '../src/modules/monitoring/jobs/stale-sweep.job';
import { DEVICE_STALE_CHANGED } from '../src/modules/monitoring/stale-events';
import { StaleMarksRepository } from '../src/modules/monitoring/stale-marks.repository';

// Capture explicit connection settings before Prisma can load a local .env at construction.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !process.env.DATABASE_DIRECT_URL) {
  throw new Error('test:db requires explicit DATABASE_URL and DATABASE_DIRECT_URL.');
}

const NOW = new Date('2026-11-01T03:00:00.000Z');
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000);

// Run only through test:db against a migrated disposable database. Ids are fresh per run, and the
// sweep reads its devices and stations from stubs, so it never meets another suite's rows; the marks
// it writes are real rows of `stale_marks`.
describe('staleness sweep marks against Postgres (monitoring task 2.4)', () => {
  const prisma = new PrismaService({ datasourceUrl: databaseUrl });
  const emitter = new EventEmitter2();
  const events = new TransactionalEvents(prisma, emitter);
  const repository = new StaleMarksRepository(prisma);
  const runId = randomUUID();
  const deviceId = `device-${runId}`;
  const organizationId = `org-${runId}`;
  const received: unknown[] = [];
  let lastSeenAt: Date | null = ago(400);

  const job = (marks: StaleMarksRepository = repository) =>
    new StaleSweepJob(
      marks,
      {
        visibleDevices: () => Promise.resolve([{ deviceId, organizationId }]),
      } as unknown as ContractsService,
      {
        projections: () => Promise.resolve([{ id: deviceId, lastSeenAt }]),
      } as unknown as DevicesService,
      { fieldStationHealth: () => Promise.resolve([]) } as unknown as OrganizationsService,
      {
        get: (key: string) =>
          Promise.resolve(key === 'monitoring.fieldStationStaleSeconds' ? 180 : 300),
      } as unknown as ParameterService,
      events,
    );

  const rows = () =>
    prisma.staleMark.findMany({
      where: { subjectType: StaleSubject.DEVICE, subjectId: deviceId },
    });

  beforeAll(() => emitter.on(DEVICE_STALE_CHANGED, (payload) => received.push(payload)));
  afterAll(async () => {
    await prisma.staleMark.deleteMany({ where: { subjectId: { startsWith: `device-${runId}` } } });
    await prisma.$disconnect();
  });

  it('writes a mark once: a second insert of the same subject reports nothing written', async () => {
    const id = `${deviceId}-direct`;
    const row = {
      subjectType: StaleSubject.DEVICE,
      subjectId: id,
      organizationId,
      lastSeenAt: ago(400),
      markedAt: NOW,
    };
    await expect(repository.mark(row)).resolves.toBe(true);
    await expect(repository.mark({ ...row, markedAt: ago(1) })).resolves.toBe(false);
    await expect(repository.clear(StaleSubject.DEVICE, id, undefined, 'another-org')).resolves.toBe(
      false,
    );
    await expect(
      repository.clear(StaleSubject.DEVICE, id, undefined, organizationId),
    ).resolves.toBe(true);
    await expect(repository.clear(StaleSubject.DEVICE, id)).resolves.toBe(false);
  });

  it('stores the stale transition and emits it after the commit, once', async () => {
    await expect(job().sweep(NOW)).resolves.toEqual({ stale: 1, recovered: 0 });
    // A new job instance stands for a restart: the stored mark keeps it from repeating the entry.
    await expect(job().sweep(NOW)).resolves.toEqual({ stale: 0, recovered: 0 });
    expect(received).toEqual([
      { deviceId, organizationId, stale: true, lastSeenAt: ago(400).toISOString() },
    ]);
    await expect(rows()).resolves.toEqual([
      expect.objectContaining({ organizationId, lastSeenAt: ago(400), markedAt: NOW }),
    ]);
  });

  it('keeps the mark and emits nothing when the transition rolls back', async () => {
    lastSeenAt = ago(1);
    // The delete succeeds, then the transaction fails: Postgres rolls the delete back.
    const failing = new StaleMarksRepository(prisma);
    const clear = failing.clear.bind(failing);
    failing.clear = async (...args: Parameters<StaleMarksRepository['clear']>) => {
      await clear(...args);
      throw new Error('fails after the delete');
    };
    await expect(job(failing).sweep(NOW)).resolves.toEqual({ stale: 0, recovered: 0 });
    expect(received).toHaveLength(1);
    await expect(rows()).resolves.toHaveLength(1);
  });

  it('removes the mark and emits one recovery when the device is heard again', async () => {
    await expect(job().sweep(NOW)).resolves.toEqual({ stale: 0, recovered: 1 });
    await expect(job().sweep(NOW)).resolves.toEqual({ stale: 0, recovered: 0 });
    expect(received).toEqual([
      expect.objectContaining({ stale: true }),
      { deviceId, organizationId, stale: false, lastSeenAt: ago(1).toISOString() },
    ]);
    await expect(rows()).resolves.toEqual([]);
  });

  it('lets only one of two concurrent sweeps report the transition', async () => {
    lastSeenAt = ago(500);
    const results = await Promise.all([job().sweep(NOW), job().sweep(NOW)]);
    expect(results.map((result) => result.stale).sort()).toEqual([0, 1]);
    expect(received.filter((payload) => (payload as { stale: boolean }).stale)).toHaveLength(2);
    await expect(rows()).resolves.toHaveLength(1);
  });
});
