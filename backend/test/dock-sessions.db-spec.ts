import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';
import { AccountType, DeviceStatus, DockEndReason } from '@prisma/client';
import { ErrorCode } from '../src/common/errors';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { DevicesRepository } from '../src/modules/devices/devices.repository';
import { DockSessionRepository } from '../src/modules/devices/dock/dock-session.repository';
import { DockSessionService } from '../src/modules/devices/dock/dock-session.service';
import { DEVICE_DOCKED, DEVICE_UNDOCKED } from '../src/modules/devices/dock/dock-events';
import { ValidatedEnvironment } from '../src/modules/platform/config/environment-variables';
import { TransactionalEvents } from '../src/modules/platform/events/emit-after-commit';
import { ParameterRepository } from '../src/modules/platform/parameters/parameter.repository';
import { ParameterService } from '../src/modules/platform/parameters/parameter.service';

// Capture explicit connection settings before Prisma can load a local .env at construction.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !process.env.DATABASE_DIRECT_URL) {
  throw new Error('test:db requires explicit DATABASE_URL and DATABASE_DIRECT_URL.');
}

// The dock sessions of devices design section 11.8 (task 10.3, api-design 31 and 32) on Postgres: open,
// renew, replace, end and expire, with the events the Staff map listens to, and two concurrent opens of
// one unit leaving one open session. Fixtures carry a fresh run ID and are never deleted.
describe('DockSessionService on Postgres', () => {
  const prisma = new PrismaService({ datasourceUrl: databaseUrl });
  const emitter = new EventEmitter2();
  const events = new TransactionalEvents(prisma, emitter);
  const config = new ConfigService<ValidatedEnvironment, true>({
    PARAMETER_CACHE_TTL_SECONDS: 0,
    DEFAULT_PAGE_SIZE: 20,
    MAX_PAGE_SIZE: 100,
  });
  const parameters = new ParameterService(new ParameterRepository(prisma), events, config);
  const sessions = new DockSessionRepository(prisma);
  const service = new DockSessionService(
    new DevicesRepository(prisma),
    sessions,
    parameters,
    events,
    {
      namesOf: (ids: readonly string[]) => Promise.resolve(new Map(ids.map((id) => [id, 'Staff']))),
    },
  );
  const runId = randomUUID();
  const emitted: { name: string; payload: unknown }[] = [];
  let staffA: { id: string; roles: string[] };
  let staffB: { id: string; roles: string[] };
  let variantId: string;
  let serial = 0;

  const unit = async () => {
    serial += 1;
    const nodeNum = BigInt(`0x${randomUUID().slice(0, 8)}`);
    const device = await prisma.device.create({
      data: {
        assetTag: `dock-test-${runId}-${serial}`,
        nodeNum,
        hardwareVariantId: variantId,
        firmwareVersion: 'test-only',
        acquiredAt: new Date('2026-06-15T00:00:00Z'),
        registeredById: staffA.id,
        status: DeviceStatus.RESERVED,
      },
    });
    return { id: device.id, nodeNum };
  };

  const staff = async (name: string) => ({
    id: (
      await prisma.user.create({
        data: {
          email: `dock-test-${runId}-${name}@example.invalid`,
          fullName: name,
          accountType: AccountType.TREKLINK,
        },
      })
    ).id,
    roles: ['STAFF'],
  });

  beforeAll(async () => {
    await prisma.$connect();
    for (const name of [DEVICE_DOCKED, DEVICE_UNDOCKED]) {
      emitter.on(name, (payload: unknown) => emitted.push({ name, payload }));
    }
    staffA = await staff('a');
    staffB = await staff('b');
    variantId = (
      await prisma.hardwareVariant.create({
        data: {
          code: `dock-test-${runId}`,
          name: 'Dock test variant',
          hasGps: true,
          hasMotionSensor: false,
          mqttCapable: true,
          firmwareBaseline: 'test-only',
          remainingValueSchedule: [],
        },
      })
    ).id;
  });

  beforeEach(() => {
    emitted.length = 0;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const openOf = (deviceId: string) =>
    prisma.deviceDockSession.findMany({ where: { deviceId, endedAt: null } });

  it('opens a session, renews it for the same caller and emits device.docked once', async () => {
    const { id, nodeNum } = await unit();
    const t0 = new Date('2026-11-04T03:00:00.000Z');

    const first = await service.dock(id, nodeNum, staffA as never, t0);
    const second = await service.dock(
      id,
      nodeNum,
      staffA as never,
      new Date(t0.getTime() + 10_000),
    );

    expect(second.since).toEqual(first.since);
    expect(second.expiresAt).toEqual(new Date(t0.getTime() + 40_000));
    await expect(openOf(id)).resolves.toHaveLength(1);
    expect(emitted.map((event) => event.name)).toEqual([DEVICE_DOCKED]);
  });

  it('replaces another caller session and ends a session past its time as EXPIRED', async () => {
    const { id, nodeNum } = await unit();
    const t0 = new Date('2026-11-04T03:00:00.000Z');
    await service.dock(id, nodeNum, staffA as never, t0);

    await service.dock(id, nodeNum, staffB as never, new Date(t0.getTime() + 5_000));
    await service.dock(id, nodeNum, staffB as never, new Date(t0.getTime() + 60_000));

    const ended = await prisma.deviceDockSession.findMany({
      where: { deviceId: id, endedAt: { not: null } },
      orderBy: { openedAt: 'asc' },
    });
    expect(ended.map((row) => row.endReason)).toEqual([
      DockEndReason.REPLACED,
      DockEndReason.EXPIRED,
    ]);
    await expect(openOf(id)).resolves.toHaveLength(1);
  });

  it('refuses another unit node number with 409 NODE_MISMATCH and opens nothing', async () => {
    const { id, nodeNum } = await unit();

    await expect(service.dock(id, nodeNum + 1n, staffA as never)).rejects.toMatchObject({
      errorCode: ErrorCode.NODE_MISMATCH,
    });
    await expect(openOf(id)).resolves.toHaveLength(0);
  });

  it('ends the session on undock, and an undock with none open succeeds', async () => {
    const { id, nodeNum } = await unit();
    await service.dock(id, nodeNum, staffA as never);

    await expect(service.undock(id)).resolves.toBeNull();
    await expect(service.undock(id)).resolves.toBeNull();

    await expect(openOf(id)).resolves.toHaveLength(0);
    expect(emitted.filter((event) => event.name === DEVICE_UNDOCKED)).toHaveLength(1);
  });

  it('keeps one open session when two Staff browsers open the same unit at once', async () => {
    const { id, nodeNum } = await unit();

    await Promise.all([
      service.dock(id, nodeNum, staffA as never),
      service.dock(id, nodeNum, staffB as never),
    ]);

    await expect(openOf(id)).resolves.toHaveLength(1);
  });

  it('expires sessions not renewed within the TTL and skips fresh ones', async () => {
    const stale = await unit();
    const fresh = await unit();
    const t0 = new Date('2026-11-04T04:00:00.000Z');
    await service.dock(stale.id, stale.nodeNum, staffA as never, t0);
    await service.dock(fresh.id, fresh.nodeNum, staffA as never, new Date(t0.getTime() + 25_000));

    await service.expireStale(new Date(t0.getTime() + 31_000));

    await expect(openOf(stale.id)).resolves.toHaveLength(0);
    await expect(openOf(fresh.id)).resolves.toHaveLength(1);
    expect(emitted.some((event) => event.name === DEVICE_UNDOCKED)).toBe(true);
  });
});
