import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AccountType, IncidentState, StaleSubject } from '@prisma/client';
import { PrismaService } from '../src/common/prisma/prisma.service';
import type { DevicesService } from '../src/modules/devices';
import { AlertDeliveriesRepository } from '../src/modules/incidents/alert-deliveries.repository';
import { IncidentLifecycle } from '../src/modules/incidents/incident-lifecycle';
import { IncidentsRepository } from '../src/modules/incidents/incidents.repository';
import { IncidentsService } from '../src/modules/incidents/incidents.service';
import { StaleSweepJob } from '../src/modules/monitoring/jobs/stale-sweep.job';
import { StaleMarksRepository } from '../src/modules/monitoring/stale-marks.repository';
import type { OrganizationsService } from '../src/modules/organizations';
import { ValidatedEnvironment } from '../src/modules/platform/config/environment-variables';
import { TransactionalEvents } from '../src/modules/platform/events/emit-after-commit';
import { ParameterRepository } from '../src/modules/platform/parameters/parameter.repository';
import { ParameterService } from '../src/modules/platform/parameters/parameter.service';
import type { ContractsService } from '../src/modules/rentals';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !process.env.DATABASE_DIRECT_URL) {
  throw new Error('test:db requires explicit DATABASE_URL and DATABASE_DIRECT_URL.');
}

// The incident stale flag against Postgres (incidents task 4.4, REQ-EVT-12, FR-INC-13). The sweep and
// IncidentsService are the real ones on one database; only the reads of rentals and devices are
// stubbed, so the sweep sees exactly this run's devices. The parameters are the seeded defaults
// (`monitoring.deviceStaleSeconds` 300). Run only through test:db on a migrated disposable database.
describe('incident stale flag against Postgres', () => {
  const prisma = new PrismaService({ datasourceUrl: databaseUrl });
  const emitter = new EventEmitter2();
  const events = new TransactionalEvents(prisma, emitter);
  const parameters = new ParameterService(
    new ParameterRepository(prisma),
    events,
    new ConfigService<ValidatedEnvironment, true>({ PARAMETER_CACHE_TTL_SECONDS: 0 }),
  );
  const repository = new IncidentsRepository(prisma);
  const incidents = new IncidentsService(
    repository,
    new IncidentLifecycle(repository, new AlertDeliveriesRepository(), parameters, events),
    parameters,
    events,
    {} as OrganizationsService,
  );
  const runId = randomUUID();
  const organizationId = `org-${runId}`;
  const changed: { incidentId: string; state: string }[] = [];
  const reading = new Map<string, Date>();
  let staffId: string;
  let variantId: string;
  let serial = 0;

  // The marks of this run only: the sweep drops a mark whose device it cannot read, and another
  // suite's rows are not this suite's to touch.
  class RunMarks extends StaleMarksRepository {
    async list(subjectType: StaleSubject) {
      return (await super.list(subjectType)).filter((row) => reading.has(row.subjectId));
    }
  }

  const sweep = (marks: StaleMarksRepository = new RunMarks(prisma)) =>
    new StaleSweepJob(
      marks,
      {
        visibleDevices: () =>
          Promise.resolve([...reading.keys()].map((deviceId) => ({ deviceId, organizationId }))),
      } as unknown as ContractsService,
      {
        projections: (ids: string[]) =>
          Promise.resolve(ids.map((id) => ({ id, lastSeenAt: reading.get(id) ?? null }))),
      } as unknown as DevicesService,
      { fieldStationHealth: () => Promise.resolve([]) } as unknown as OrganizationsService,
      incidents,
      parameters,
      events,
    );

  // A device with an incident in the given state; the episode's own position and fix time are set.
  const incidentOn = async (state: IncidentState) => {
    serial += 1;
    const device = await prisma.device.create({
      data: {
        assetTag: `stale-${runId.slice(0, 8)}-${serial}`,
        nodeNum: BigInt(`0x${randomUUID().slice(0, 8)}`),
        hardwareVariantId: variantId,
        firmwareVersion: 'test-only',
        acquiredAt: new Date(Date.now() - 86_400_000),
        registeredById: staffId,
        status: 'RENTED',
      },
    });
    const at = new Date(Date.now() - 600_000);
    const incident = await prisma.incident.create({
      data: {
        code: `INC-STALE-${runId.slice(0, 8)}-${serial}`,
        deviceId: device.id,
        state,
        source: 'DEVICE_SOS',
        confidence: 'CONFIRMED',
        firstEventAt: at,
        lastEventAt: at,
        lastLatitude: 11.56,
        lastLongitude: 108.54,
        lastPositionAt: at,
        version: 3,
      },
    });
    return { deviceId: device.id, incidentId: incident.id };
  };

  const incident = (id: string) => prisma.incident.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    emitter.on('incident.changed', (payload: { incidentId: string; state: string }) =>
      changed.push(payload),
    );
    staffId = (
      await prisma.user.create({
        data: {
          email: `stale-staff-${runId}@example.invalid`,
          fullName: 'Stale flag staff',
          accountType: AccountType.TREKLINK,
        },
      })
    ).id;
    variantId = (
      await prisma.hardwareVariant.create({
        data: {
          code: `stale-${runId}`,
          name: 'Stale flag variant',
          hasGps: true,
          hasMotionSensor: false,
          mqttCapable: true,
          firmwareBaseline: 'test-only',
          remainingValueSchedule: [],
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.staleMark.deleteMany({
      where: { subjectType: StaleSubject.DEVICE, subjectId: { in: [...reading.keys()] } },
    });
    await prisma.$disconnect();
  });

  it('flags the open incident stale and keeps its state, owner, position and version', async () => {
    const { deviceId, incidentId } = await incidentOn('ACKNOWLEDGED');
    reading.set(deviceId, new Date(Date.now() - 400_000));
    const before = await incident(incidentId);

    await expect(sweep().sweep()).resolves.toMatchObject({ stale: 1 });

    const after = await incident(incidentId);
    expect(after.stale).toBe(true);
    expect(after).toMatchObject({
      state: before.state,
      ownerId: before.ownerId,
      version: before.version,
      lastPositionAt: before.lastPositionAt,
      lastLatitude: before.lastLatitude,
      statusDueAt: before.statusDueAt,
    });
    expect(changed).toContainEqual(expect.objectContaining({ incidentId, state: 'ACKNOWLEDGED' }));
  });

  it('clears the flag once when the device is heard again', async () => {
    const { deviceId, incidentId } = await incidentOn('NOTIFY_PRIMARY');
    reading.set(deviceId, new Date(Date.now() - 400_000));
    await sweep().sweep();
    expect((await incident(incidentId)).stale).toBe(true);

    reading.set(deviceId, new Date());
    await sweep().sweep();
    const after = await incident(incidentId);
    expect(after.stale).toBe(false);
    expect(after.version).toBe(3);
    const notices = changed.filter((event) => event.incidentId === incidentId);
    expect(notices).toHaveLength(2);
    await sweep().sweep();
    expect(changed.filter((event) => event.incidentId === incidentId)).toHaveLength(2);
  });

  it('leaves a CLOSED incident alone', async () => {
    const { deviceId, incidentId } = await incidentOn('CLOSED');
    reading.set(deviceId, new Date(Date.now() - 400_000));
    await sweep().sweep();
    expect((await incident(incidentId)).stale).toBe(false);
    expect(changed.some((event) => event.incidentId === incidentId)).toBe(false);
  });

  it('rolls the flag back with a transition that fails after it', async () => {
    const { deviceId, incidentId } = await incidentOn('RESPONDING');
    reading.set(deviceId, new Date(Date.now() - 400_000));
    // The mark is written and the flag set, then the transaction fails: neither stays.
    const failing = new RunMarks(prisma);
    const failingIncidents = Object.create(incidents) as IncidentsService;
    failingIncidents.markDeviceStale = async (...args) => {
      await incidents.markDeviceStale(...args);
      throw new Error('fails after the flag');
    };
    const job = new StaleSweepJob(
      failing,
      {
        visibleDevices: () => Promise.resolve([{ deviceId, organizationId }]),
      } as unknown as ContractsService,
      {
        projections: () => Promise.resolve([{ id: deviceId, lastSeenAt: reading.get(deviceId) }]),
      } as unknown as DevicesService,
      { fieldStationHealth: () => Promise.resolve([]) } as unknown as OrganizationsService,
      failingIncidents,
      parameters,
      events,
    );
    await expect(job.sweep()).resolves.toEqual({ stale: 0, recovered: 0 });
    expect((await incident(incidentId)).stale).toBe(false);
    await expect(
      prisma.staleMark.count({ where: { subjectType: StaleSubject.DEVICE, subjectId: deviceId } }),
    ).resolves.toBe(0);
    expect(changed.some((event) => event.incidentId === incidentId)).toBe(false);
  });
});
