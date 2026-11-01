import { randomUUID } from 'node:crypto';
import { AccountType, ContractStatus, PlanType, Prisma } from '@prisma/client';
import type { Caller, PolicyAbility } from '../src/common/decorators/access.decorator';
import { PrismaService } from '../src/common/prisma/prisma.service';
import type { DevicesService } from '../src/modules/devices';
import { DevicesRepository } from '../src/modules/devices/devices.repository';
import type { IncidentsQueryService } from '../src/modules/incidents';
import { LiveMapService } from '../src/modules/monitoring/live-map.service';
import { OrgApiService } from '../src/modules/monitoring/org-api.service';
import type { ReplayService } from '../src/modules/monitoring/replay.service';
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

// D-040 and D-092 rule 2 on the organization API (api-design 04) against Postgres: the units of one
// open contract, read once through the organization's map snapshot (api-design 02) and once through
// `OrgApiService.devicesOf`, must agree on the state and on every clipped reading. The custody rows come
// from the real rentals read and the projections from the real devices read, written through
// `projectIfNewer` as ingestion writes them. Run only through test:db against a migrated disposable
// database. Fixtures carry a fresh run ID.
describe('the organization API clips readings to the custody interval as the map does', () => {
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
  const parameters = {
    get: (key: string) =>
      Promise.resolve(
        (
          {
            'monitoring.deviceStaleSeconds': 300,
            'monitoring.fieldStationStaleSeconds': 180,
            'monitoring.counterLocation': { name: 'TrekLink counter', lat: 11.9, lon: 108.4 },
          } as Record<string, unknown>
        )[key],
      ),
  } as unknown as ParameterService;
  const devices = {
    projections: (ids: readonly string[]) => devicesRepository.projections(ids),
  } as unknown as DevicesService;
  const incidents = {
    openByDevices: () => Promise.resolve(new Map()),
  } as unknown as IncidentsQueryService;
  const stream = { maxSeq: () => Promise.resolve(7) } as unknown as StreamRepository;
  const map = new LiveMapService(parameters, contracts, devices, incidents, stream, {
    fieldStationHealth: () => Promise.resolve([]),
  } as unknown as OrganizationsService);
  const api = new OrgApiService(
    contracts,
    devices,
    incidents,
    {} as unknown as ReplayService,
    stream,
    parameters,
  );
  const runId = randomUUID();
  const tag = (name: string) => `OA-${name}-${runId.slice(0, 8)}`;
  let organizationId: string;
  const unit: Record<string, string> = {};

  const member = (): PolicyAbility => ({
    can: (_action, target) =>
      typeof target === 'object' &&
      (target as { organizationId?: string }).organizationId === organizationId,
  });
  const callerOf = (organization: string): Caller => ({
    id: 'u-1',
    roles: [],
    organizationId: organization,
  });

  beforeAll(async () => {
    await prisma.$connect();
    const staffId = (
      await prisma.user.create({
        data: {
          email: `org-api-custody-${runId}@example.invalid`,
          fullName: 'Org API custody staff',
          accountType: AccountType.TREKLINK,
        },
      })
    ).id;
    const variantId = (
      await prisma.hardwareVariant.create({
        data: {
          code: `org-api-custody-${runId}`,
          name: 'Org API custody variant',
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
          legalName: 'Org API custody test',
          taxCode: `org-api-custody-${runId}`,
          address: 'Test address',
          contactEmail: `org-api-custody-org-${runId}@example.invalid`,
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
    for (const name of ['live', 'oldfix', 'silent', 'intake', 'quiet']) {
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
    // Heard in custody.
    await read('live', 20, [11.56, 108.54], 81);
    // Heard in custody without a fix; its only fix came before the handover.
    await read('oldfix', 7200, [12.5, 109.1], 95);
    await read('oldfix', 30, undefined, 77);
    // Offline in custody.
    await read('silent', 900, [11.6, 108.6], 60);
    // Heard before the handover only, at intake.
    await read('intake', 7200, [10.8, 106.7], 99);
  });

  afterAll(() => prisma.$disconnect());

  it('answers the same state and readings on the map snapshot and on api-design 04', async () => {
    const snapshot = await map.snapshot({}, callerOf(organizationId), member(), NOW);
    const answer = await api.devicesOf(organizationId, NOW);
    const shared = (device: Record<string, unknown>) => ({
      id: device.id,
      assetTag: device.assetTag,
      state: device.state,
      stale: device.stale,
      position: device.position,
      lastSeenAt: device.lastSeenAt,
      batteryPct: device.batteryPct,
      contractCode: device.contractCode,
    });
    const byId = (devices: object[]) =>
      Object.fromEntries(
        devices.map((device) => [(device as { id: string }).id, shared({ ...device })]),
      );
    const fromMap = byId(snapshot.devices);
    // Serialized as the envelope sends it.
    const fromApi = byId(JSON.parse(JSON.stringify(answer.devices)) as object[]);
    expect(Object.keys(fromApi).sort()).toEqual(Object.values(unit).sort());
    expect(fromApi).toEqual(fromMap);
  });

  it('gives each unit its custody state and nothing from before the handover', async () => {
    const answer = JSON.parse(JSON.stringify(await api.devicesOf(organizationId, NOW))) as {
      devices: { assetTag: string }[];
    };
    const units = Object.fromEntries(answer.devices.map((device) => [device.assetTag, device]));
    expect(units[tag('live')]).toMatchObject({
      state: 'LIVE',
      stale: false,
      position: { lat: 11.56, lon: 108.54, at: ago(20).toISOString() },
      lastSeenAt: ago(20).toISOString(),
      batteryPct: 81,
    });
    expect(units[tag('oldfix')]).toMatchObject({
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
    for (const name of ['intake', 'quiet']) {
      expect(units[tag(name)]).toMatchObject({
        state: 'NOT_HEARD',
        stale: false,
        position: null,
        lastSeenAt: null,
        batteryPct: null,
      });
    }
    const text = JSON.stringify(answer);
    expect(text).not.toContain('12.5');
    expect(text).not.toContain('10.8');
    expect(text).not.toContain(ago(7200).toISOString());
  });
});
