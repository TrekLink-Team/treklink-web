import './db-app-env';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { seedDemo } from '../prisma/seed-demo';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { FieldSimulationService } from '../src/modules/gateway-sync';
import { LiveMapService } from '../src/modules/monitoring/live-map.service';

// Capture explicit connection settings before Prisma can load a local .env at construction.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !process.env.DATABASE_DIRECT_URL) {
  throw new Error('test:db requires explicit DATABASE_URL and DATABASE_DIRECT_URL.');
}
if (/\.neon\.tech/i.test(databaseUrl)) {
  throw new Error('demo-simulation.db-spec seeds the database; never run it against Neon.');
}

// specs/demo tasks 5.6 (requirements §2.4, AC-06 and AC-07, design §9): the field simulation against
// Postgres through the real services. The demo seed's fixed codes collide with the rentals suites, so
// the spec runs in a schema of its own, migrated here, seeded and dropped at the end (as
// seed-demo-history.db-spec.ts does). AppModule is compiled, not started: no scheduler job runs, and the
// simulator runs are called with explicit times.
describe('field simulation on Postgres (demo design §9)', () => {
  const schema = `demo_simulation_${randomUUID().slice(0, 8)}`;
  const url = new URL(databaseUrl);
  url.searchParams.set('schema', schema);
  const prisma = new PrismaService({ datasourceUrl: url.toString() });
  let simulation: FieldSimulationService;
  let map: LiveMapService;
  let close: () => Promise<void>;
  let actor: { id: string; roles: string[] };
  let deviceId: string;
  let nodeId: string;
  let version: number;

  // Minute-aligned times after the seeded handover and its attribution margin.
  const base = Math.floor(Date.now() / 60_000) * 60_000;
  const at = (seconds: number) => new Date(base + seconds * 1000);

  const simulatedEvents = () =>
    prisma.fieldEvent.findMany({
      where: { deviceId, simulated: true },
      orderBy: { seq: 'asc' },
    });
  const fleetSnapshot = (now: Date) =>
    map.snapshot(
      {},
      { id: actor.id, roles: ['ADMIN'], organizationId: null },
      { can: () => true },
      now,
    );

  beforeAll(async () => {
    execFileSync(
      process.execPath,
      [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'],
      {
        cwd: join(__dirname, '..'),
        env: { ...process.env, DATABASE_URL: url.toString(), DATABASE_DIRECT_URL: url.toString() },
        stdio: 'pipe',
      },
    );
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    close = () => moduleRef.close();
    simulation = moduleRef.get(FieldSimulationService, { strict: false });
    map = moduleRef.get(LiveMapService, { strict: false });
    const password = 'Demo-simulation-1';
    // Two hours back, so every simulated reading falls after the handover and its margin.
    await seedDemo(
      prisma,
      { admin: password, staff: password, manager: password, operator: password },
      { now: new Date(base - 2 * 3600 * 1000), bcryptCost: 4 },
    );
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@treklink.local' } });
    actor = { id: admin.id, roles: ['ADMIN'] };
    deviceId = (await prisma.device.findUniqueOrThrow({ where: { assetTag: 'TL-0010' } })).id;
  }, 180_000);

  afterAll(async () => {
    await close?.();
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await prisma.$disconnect();
  });

  it('starts TL-0010 on WALK, and two runs in one interval store each packet once', async () => {
    const started = await simulation.start(
      { deviceId, trailId: 'ta-nang-phan-dung', pattern: 'WALK' },
      actor,
      at(0),
    );
    nodeId = started.id;
    version = started.version;
    expect(started).toMatchObject({ assetTag: 'TL-0010', status: 'RUNNING', simulated: true });
    await expect(
      simulation.start({ deviceId, trailId: 'ta-nang-phan-dung', pattern: 'WALK' }, actor, at(1)),
    ).rejects.toMatchObject({ errorCode: 'DEMO_NODE_RUNNING' });

    await simulation.run(at(10));
    await simulation.run(at(40));
    const events = await simulatedEvents();
    expect(events.map((e) => e.kind)).toEqual(['POSITION', 'TELEMETRY']);
    expect(events.every((e) => e.attribution === 'ATTRIBUTED' && e.plotted)).toBe(true);

    await simulation.run(at(70));
    expect(await simulatedEvents()).toHaveLength(4);
    const snapshot = await fleetSnapshot(at(75));
    expect(snapshot.devices.find((d) => d.id === deviceId)).toMatchObject({
      simulated: true,
      stale: false,
      state: 'LIVE',
    });
  });

  it('opens exactly one simulated incident from an SOS, routed to the on-duty operator; a second SOS joins it', async () => {
    const first = await simulation.raise(nodeId, 'SOS', actor, at(80));
    expect(first.fieldEventId).toMatch(/^[0-9a-f]{64}$/);
    const incidents = await prisma.incident.findMany({ where: { deviceId } });
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({
      simulated: true,
      source: 'DEVICE_SOS',
      state: 'NOTIFY_PRIMARY',
    });
    const text = await prisma.fieldEvent.findUniqueOrThrow({
      where: { eventId: first.fieldEventId! },
    });
    expect(text).toMatchObject({ kind: 'SOS', simulated: true, incidentId: incidents[0].id });

    const again = await simulation.raise(nodeId, 'SOS', actor, at(90));
    version = again.node.version;
    const after = await prisma.incident.findMany({ where: { deviceId } });
    expect(after).toHaveLength(1);
    expect(after[0].eventCount).toBeGreaterThan(incidents[0].eventCount);
  });

  it('sends the beacons, then none after SOS_CANCEL, and the incident stays open', async () => {
    const before = (await simulatedEvents()).length;
    // Beacons at offsets 5 to 30 s of the second SOS (90 s), plus the interval's telemetry.
    await simulation.run(at(120));
    const beacons = (await simulatedEvents())
      .slice(before)
      .filter((e) => e.kind === 'POSITION')
      .map((e) => (e.occurredAt.getTime() - base) / 1000);
    expect(beacons).toEqual([95, 100, 105, 110, 115, 120]);

    const cancelled = await simulation.raise(nodeId, 'SOS_CANCEL', actor, at(125));
    expect(cancelled.fieldEventId).toBeNull();
    version = cancelled.node.version;
    const sent = (await simulatedEvents()).length;
    await simulation.run(at(185));
    const later = (await simulatedEvents()).slice(sent);
    // Only the interval's own position and telemetry, timed at the interval start: no beacon.
    expect(later.map((e) => (e.occurredAt.getTime() - base) / 1000)).toEqual([180, 180]);
    const [incident] = await prisma.incident.findMany({ where: { deviceId } });
    expect(['RESOLVED', 'FALSE_ALARM', 'CLOSED']).not.toContain(incident.state);
  });

  it('turns the device stale under SILENT after the threshold, and WALK clears it', async () => {
    const silent = await simulation.update(
      nodeId,
      { expectedVersion: version, pattern: 'SILENT' },
      actor,
      at(190),
    );
    const sent = (await simulatedEvents()).length;
    await simulation.run(at(250));
    await simulation.run(at(490));
    expect(await simulatedEvents()).toHaveLength(sent);
    // The last reading was at 180 s; monitoring.deviceStaleSeconds is 300.
    const stale = await fleetSnapshot(at(500));
    expect(stale.devices.find((d) => d.id === deviceId)).toMatchObject({
      stale: true,
      state: 'OFFLINE',
    });

    const walking = await simulation.update(
      nodeId,
      { expectedVersion: silent.version, pattern: 'WALK' },
      actor,
      at(500),
    );
    await simulation.run(at(545));
    const live = await fleetSnapshot(at(550));
    expect(live.devices.find((d) => d.id === deviceId)).toMatchObject({
      stale: false,
      simulated: true,
    });

    const stopped = await simulation.stop(nodeId, walking.version, actor, at(560));
    expect(stopped.status).toBe('STOPPED');
    const count = (await simulatedEvents()).length;
    await simulation.run(at(610));
    expect(await simulatedEvents()).toHaveLength(count);
  });
});
