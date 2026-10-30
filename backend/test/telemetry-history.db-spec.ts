import { randomUUID } from 'node:crypto';
import {
  AccountType,
  AttributionState,
  EventKind,
  IngressPath,
  PriorityTier,
  TimeSource,
} from '@prisma/client';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { FieldEventQueryService } from '../src/modules/gateway-sync';
import { SyncQueryRepository } from '../src/modules/gateway-sync/sync-query.repository';

// Capture explicit connection settings before Prisma can load a local .env at construction.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !process.env.DATABASE_DIRECT_URL) {
  throw new Error('test:db requires explicit DATABASE_URL and DATABASE_DIRECT_URL.');
}

// The device history read (monitoring api-design 03) against Postgres: one device rented by two
// organizations in turn, a plotted and an unplotted position. An organization reads the events
// ingestion attributed to it, Staff and Admin read every event, an unplotted position is never
// answered, `from` is inclusive and `to` exclusive, and the cap answers the oldest points with
// `truncated`. Run only through test:db against a migrated disposable database. Fixtures carry a
// fresh run ID and are never deleted.
describe('FieldEventQueryService.historyPoints on Postgres', () => {
  const prisma = new PrismaService({ datasourceUrl: databaseUrl });
  const service = new FieldEventQueryService(new SyncQueryRepository(prisma), {} as never);
  const runId = randomUUID();
  const at = (minute: number) => new Date(Date.UTC(2026, 9, 20, 3, minute));
  const from = at(0);
  const to = at(30);
  let deviceId: string;
  let orgA: string;
  let orgB: string;

  const organization = async (tag: string) =>
    (
      await prisma.organization.create({
        data: {
          code: `HT${tag}-${runId.slice(0, 8)}`,
          legalName: `History test ${tag}`,
          taxCode: `history-${tag}-${runId}`,
          address: 'Test address',
          contactEmail: `history-test-${tag}-${runId}@example.invalid`,
          contactPhone: '0900000000',
        },
      })
    ).id;

  const event = (
    minute: number,
    kind: EventKind,
    organizationId: string | null,
    extra: { plotted?: boolean; latitude?: number; longitude?: number; batteryPct?: number } = {},
  ) =>
    prisma.fieldEvent.create({
      data: {
        eventId: `history-test-${runId}-${randomUUID()}`,
        deviceId,
        organizationId,
        attribution:
          organizationId === null ? AttributionState.UNATTRIBUTED : AttributionState.ATTRIBUTED,
        uplinkKey: '!history-test',
        ingress: IngressPath.MQTT_NODE,
        kind,
        priority: kind === EventKind.POSITION ? PriorityTier.P2_GPS : PriorityTier.P3_TELEMETRY,
        occurredAt: at(minute),
        timeSource: TimeSource.DEVICE_RTC,
        payload: {},
        ...extra,
      },
    });

  const minutes = (points: { at: Date }[]) => points.map((point) => point.at.getUTCMinutes());
  const both = [EventKind.POSITION, EventKind.TELEMETRY] as const;

  beforeAll(async () => {
    await prisma.$connect();
    const staffId = (
      await prisma.user.create({
        data: {
          email: `history-test-${runId}@example.invalid`,
          fullName: 'History test staff',
          accountType: AccountType.TREKLINK,
        },
      })
    ).id;
    const variantId = (
      await prisma.hardwareVariant.create({
        data: {
          code: `history-test-${runId}`,
          name: 'History test variant',
          hasGps: true,
          hasMotionSensor: false,
          mqttCapable: true,
          firmwareBaseline: 'test-only',
          remainingValueSchedule: [],
        },
      })
    ).id;
    deviceId = (
      await prisma.device.create({
        data: {
          assetTag: `history-test-${runId}`,
          nodeNum: BigInt(`0x${randomUUID().slice(0, 8)}`),
          hardwareVariantId: variantId,
          firmwareVersion: 'test-only',
          acquiredAt: at(0),
          registeredById: staffId,
        },
      })
    ).id;
    [orgA, orgB] = [await organization('A'), await organization('B')];

    // Organization A held the unit first, then B. Minute 0 sits on `from`, minute 30 on `to`.
    await event(0, EventKind.POSITION, orgA, { latitude: 11.56, longitude: 108.54 });
    await event(5, EventKind.TELEMETRY, orgA, { batteryPct: 90 });
    await event(10, EventKind.POSITION, orgA, { plotted: false, latitude: 48.85, longitude: 2.35 });
    await event(15, EventKind.TELEMETRY, null, { batteryPct: 88 });
    await event(20, EventKind.POSITION, orgB, { latitude: 11.57, longitude: 108.55 });
    await event(30, EventKind.TELEMETRY, orgB, { batteryPct: 85 });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('gives an organization only the events attributed to it, and never the unplotted position', async () => {
    const a = await service.historyPoints({
      deviceId,
      organizationId: orgA,
      from,
      to,
      kinds: both,
    });
    expect(minutes(a.points)).toEqual([0, 5]);
    expect(a.truncated).toBe(false);

    const b = await service.historyPoints({
      deviceId,
      organizationId: orgB,
      from,
      to,
      kinds: both,
    });
    expect(minutes(b.points)).toEqual([20]);
    expect(b.points[0]).toMatchObject({ kind: 'POSITION', lat: 11.57, lon: 108.55 });
  });

  it('gives Staff and Admin every event in the range, UNATTRIBUTED included, oldest first', async () => {
    const all = await service.historyPoints({
      deviceId,
      organizationId: null,
      from,
      to,
      kinds: both,
    });
    expect(minutes(all.points)).toEqual([0, 5, 15, 20]);
  });

  it('takes from as inclusive and to as exclusive, and filters by kind', async () => {
    const telemetry = await service.historyPoints({
      deviceId,
      organizationId: null,
      from: at(5),
      to: at(31),
      kinds: [EventKind.TELEMETRY],
    });
    expect(minutes(telemetry.points)).toEqual([5, 15, 30]);
  });

  it('answers the oldest points up to the cap and flags the rest', async () => {
    const capped = await service.historyPoints(
      { deviceId, organizationId: null, from, to, kinds: both },
      3,
    );
    expect(minutes(capped.points)).toEqual([0, 5, 15]);
    expect(capped.truncated).toBe(true);

    const exact = await service.historyPoints(
      { deviceId, organizationId: null, from, to, kinds: both },
      4,
    );
    expect(exact.truncated).toBe(false);
  });
});
