import { randomUUID } from 'node:crypto';
import { AccountType, ContractStatus, PlanType, Prisma } from '@prisma/client';
import type { Caller, PolicyAbility } from '../src/common/decorators/access.decorator';
import { PrismaService } from '../src/common/prisma/prisma.service';
import type { DevicesService } from '../src/modules/devices';
import { DevicesRepository } from '../src/modules/devices/devices.repository';
import type { IncidentsQueryService } from '../src/modules/incidents';
import { LiveMapService } from '../src/modules/monitoring/live-map.service';
import type { StreamRepository } from '../src/modules/monitoring/stream.repository';
import type { OrganizationsService } from '../src/modules/organizations';
import type { ParameterService } from '../src/modules/platform/parameters/parameter.service';
import { ContractsService } from '../src/modules/rentals';
import { ContractsRepository } from '../src/modules/rentals/contracts.repository';

// Capture explicit connection settings before Prisma can load a local .env at construction.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !process.env.DATABASE_DIRECT_URL) {
  throw new Error('test:db requires explicit DATABASE_URL and DATABASE_DIRECT_URL.');
}

const NOW = new Date('2026-11-01T03:00:00.000Z');
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000);
const HANDED_OVER = ago(3600);
const COUNTER = { name: 'TrekLink counter', lat: 11.9, lon: 108.4 };

// Monitoring AC-08 (REQ-UBI-04, D-092 rule 2) against Postgres: one open contract of 5 units, where 2
// report, 1 reported and went silent past the threshold, and 2 never reported since the handover (one
// of them reported before it, at intake). The custody rows come from the real rentals read and the
// projections from the real devices read, written through `projectIfNewer` as ingestion writes them.
// Run only through test:db against a migrated disposable database. Fixtures carry a fresh run ID.
describe('LiveMapService.snapshot lists every unit of an open contract (AC-08)', () => {
  const prisma = new PrismaService({ datasourceUrl: databaseUrl });
  const devicesRepository = new DevicesRepository(prisma);
  const contracts = new ContractsService(
    new ContractsRepository(prisma),
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const parameters: Record<string, unknown> = {
    'monitoring.deviceStaleSeconds': 300,
    'monitoring.fieldStationStaleSeconds': 180,
    'monitoring.counterLocation': COUNTER,
  };
  const service = new LiveMapService(
    { get: (key: string) => Promise.resolve(parameters[key]) } as unknown as ParameterService,
    contracts,
    {
      projections: (ids: readonly string[]) => devicesRepository.projections(ids),
    } as unknown as DevicesService,
    { openByDevices: () => Promise.resolve(new Map()) } as unknown as IncidentsQueryService,
    { maxSeq: () => Promise.resolve(7) } as unknown as StreamRepository,
    { fieldStationHealth: () => Promise.resolve([]) } as unknown as OrganizationsService,
  );
  const runId = randomUUID();
  const tag = (name: string) => `LM-${name}-${runId.slice(0, 8)}`;
  let organizationId: string;
  const unit: Record<string, string> = {};

  const member = (): PolicyAbility => ({
    can: (_action, target) =>
      typeof target === 'object' &&
      (target as { organizationId?: string }).organizationId === organizationId,
  });
  const staff: PolicyAbility = { can: () => true };
  const callerOf = (organization: string | null): Caller => ({
    id: 'u-1',
    roles: [],
    organizationId: organization,
  });

  beforeAll(async () => {
    await prisma.$connect();
    const staffId = (
      await prisma.user.create({
        data: {
          email: `live-map-units-${runId}@example.invalid`,
          fullName: 'Live map units staff',
          accountType: AccountType.TREKLINK,
        },
      })
    ).id;
    const variantId = (
      await prisma.hardwareVariant.create({
        data: {
          code: `live-map-units-${runId}`,
          name: 'Live map units variant',
          hasGps: true,
          hasMotionSensor: false,
          mqttCapable: true,
          firmwareBaseline: 'test-only',
          remainingValueSchedule: [],
        },
      })
    ).id;
    organizationId = (
      await prisma.organization.create({
        data: {
          code: tag('ORG'),
          legalName: 'Live map units test',
          taxCode: `live-map-units-${runId}`,
          address: 'Test address',
          contactEmail: `live-map-units-org-${runId}@example.invalid`,
          contactPhone: '0900000000',
        },
      })
    ).id;
    const contract = await prisma.rentalContract.create({
      data: {
        code: tag('RC'),
        organizationId,
        planType: PlanType.MONTHLY,
        hardwareVariantId: variantId,
        quantity: 5,
        requestedStartDate: new Date('2026-10-31T00:00:00Z'),
        monthlyUnitPriceVnd: 250_000n,
        holdingFeeRatio: new Prisma.Decimal('0.5'),
        requestedById: staffId,
        status: ContractStatus.ACTIVE,
      },
    });
    for (const name of ['live1', 'live2', 'silent', 'quiet', 'intake']) {
      unit[name] = (
        await prisma.device.create({
          data: {
            assetTag: tag(name),
            nodeNum: BigInt(Number.parseInt(randomUUID().slice(0, 7), 16)),
            hardwareVariantId: variantId,
            firmwareVersion: 'test-only',
            acquiredAt: ago(86_400 * 30),
            registeredById: staffId,
            status: 'RENTED',
          },
        })
      ).id;
      await prisma.contractDevice.create({
        data: { contractId: contract.id, deviceId: unit[name], handedOverAt: HANDED_OVER },
      });
    }
    // Readings in the order ingestion would apply them.
    const read = (name: string, seconds: number, position?: [number, number], battery?: number) =>
      devicesRepository.projectIfNewer(unit[name], {
        at: ago(seconds),
        ...(position ? { latitude: position[0], longitude: position[1] } : {}),
        ...(battery !== undefined ? { batteryPct: battery } : {}),
      });
    await read('live1', 20, [11.56, 108.54], 81);
    // live2: the last fix came before the handover (the previous custody), telemetry since.
    await read('live2', 7200, [12.5, 109.1], 95);
    await read('live2', 30, undefined, 77);
    await read('silent', 900, [11.6, 108.6], 60);
    // intake: heard with a fix at intake, before the handover, never since.
    await read('intake', 7200, [10.8, 106.7], 99);
  });

  afterAll(() => prisma.$disconnect());

  const byTag = (devices: { assetTag: string }[]) =>
    Object.fromEntries(devices.map((device) => [device.assetTag, device]));

  it('lists all 5 units to the organization, each in its state, nothing from before the handover', async () => {
    const snapshot = await service.snapshot({}, callerOf(organizationId), member(), NOW);
    const mine = snapshot.devices.filter((device) => device.organizationId === organizationId);
    expect(mine).toHaveLength(5);
    const units = byTag(mine);
    expect(units[tag('live1')]).toMatchObject({
      state: 'LIVE',
      stale: false,
      position: { lat: 11.56, lon: 108.54, at: ago(20).toISOString() },
      lastSeenAt: ago(20).toISOString(),
      batteryPct: 81,
      counterLocation: null,
    });
    // Heard since the handover, but its only fix is the previous custody's: no position.
    expect(units[tag('live2')]).toMatchObject({
      state: 'LIVE',
      position: null,
      lastSeenAt: ago(30).toISOString(),
      batteryPct: 77,
    });
    expect(units[tag('silent')]).toMatchObject({
      state: 'OFFLINE',
      stale: true,
      position: { lat: 11.6, lon: 108.6, at: ago(900).toISOString() },
      lastSeenAt: ago(900).toISOString(),
    });
    for (const name of ['quiet', 'intake']) {
      expect(units[tag(name)]).toMatchObject({
        state: 'NOT_HEARD',
        stale: false,
        position: null,
        lastSeenAt: null,
        batteryPct: null,
        counterLocation: COUNTER,
        handedOverAt: HANDED_OVER.toISOString(),
      });
    }
    // No coordinate from before the handover appears anywhere in the organization's answer.
    const text = JSON.stringify(mine);
    expect(text).not.toContain('12.5');
    expect(text).not.toContain('10.8');
    expect(text).not.toContain(ago(7200).toISOString());
  });

  it('gives TrekLink staff the same states and the stored readings', async () => {
    const snapshot = await service.snapshot({ organizationId }, callerOf(null), staff, NOW);
    const units = byTag(snapshot.devices);
    expect(Object.keys(units)).toHaveLength(5);
    expect(units[tag('intake')]).toMatchObject({
      state: 'NOT_HEARD',
      position: { lat: 10.8, lon: 106.7, at: ago(7200).toISOString() },
      lastSeenAt: ago(7200).toISOString(),
      counterLocation: COUNTER,
    });
    expect(units[tag('quiet')]).toMatchObject({ state: 'NOT_HEARD', position: null });
    expect(units[tag('live2')]).toMatchObject({
      state: 'LIVE',
      position: { lat: 12.5, lon: 109.1, at: ago(7200).toISOString() },
    });
  });

  it('drops a unit from the map at check-in', async () => {
    await prisma.contractDevice.updateMany({
      where: { deviceId: unit.quiet },
      data: { checkedInAt: NOW },
    });
    const snapshot = await service.snapshot({}, callerOf(organizationId), member(), NOW);
    expect(snapshot.devices.map((device) => device.assetTag)).not.toContain(tag('quiet'));
    expect(snapshot.devices).toHaveLength(4);
  });
});
