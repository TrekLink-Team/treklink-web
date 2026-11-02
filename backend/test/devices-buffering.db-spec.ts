import { randomUUID } from 'node:crypto';
import { AccountType } from '@prisma/client';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { SyncQueryRepository } from '../src/modules/gateway-sync/sync-query.repository';

// Capture explicit connection settings before Prisma can load a local .env at construction.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !process.env.DATABASE_DIRECT_URL) {
  throw new Error('test:db requires explicit DATABASE_URL and DATABASE_DIRECT_URL.');
}

const NOW = new Date('2026-11-02T03:00:00.000Z');
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000);

// gateway-sync REQ-EVT-13 against Postgres: `devicesBuffering` keeps the newest queue report of each
// device (DISTINCT ON "deviceId" ordered by "receivedAt" DESC) and counts the devices whose total depth is
// above zero. Run only through test:db against a migrated disposable database. Other suites may leave
// reports behind, so the count is read before and after five fresh devices report, never as an absolute.
describe('SyncQueryRepository.devicesBuffering counts the newest queue report of each device', () => {
  const prisma = new PrismaService({ datasourceUrl: databaseUrl });
  const repository = new SyncQueryRepository(prisma);
  const runId = randomUUID();
  const deviceIds: string[] = [];
  let userId: string;
  let variantId: string;

  const report = (deviceId: string, depth: number[], receivedAt: Date) =>
    prisma.deviceQueueReport.create({
      data: {
        deviceId,
        schemaVersion: 1,
        uptimeSeconds: 600,
        capacity: 256,
        depth,
        enqueued: [0, 0, 0, 0],
        published: [0, 0, 0, 0],
        shed: [0, 0, 0, 0],
        p0Refused: 0,
        flashWriteFailed: 0,
        restoreDiscarded: 0,
        receivedAt,
      },
    });

  const device = async (name: string): Promise<string> => {
    const created = await prisma.device.create({
      data: {
        assetTag: `BUF-${name}-${runId.slice(0, 8)}`,
        nodeNum: BigInt(Number.parseInt(randomUUID().slice(0, 7), 16)),
        hardwareVariantId: variantId,
        firmwareVersion: 'test-only',
        acquiredAt: ago(86_400 * 30),
        registeredById: userId,
        status: 'AVAILABLE',
      },
    });
    deviceIds.push(created.id);
    return created.id;
  };

  beforeAll(async () => {
    await prisma.$connect();
    userId = (
      await prisma.user.create({
        data: {
          email: `devices-buffering-${runId}@example.invalid`,
          fullName: 'Devices buffering staff',
          accountType: AccountType.TREKLINK,
        },
      })
    ).id;
    variantId = (
      await prisma.hardwareVariant.create({
        data: {
          code: `devices-buffering-${runId}`,
          name: 'Devices buffering variant',
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
    await prisma.deviceQueueReport.deleteMany({ where: { deviceId: { in: deviceIds } } });
    await prisma.device.deleteMany({ where: { id: { in: deviceIds } } });
    await prisma.hardwareVariant.deleteMany({ where: { id: variantId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('counts a device whose newest report holds messages, and not one that drained since or never held any', async () => {
    const before = (await repository.devicesBuffering()) ?? 0;

    // Drained: an older report with messages, a newer one that is empty. Not buffering.
    const drained = await device('drained');
    await report(drained, [0, 0, 5, 0], ago(600));
    await report(drained, [0, 0, 0, 0], ago(60));
    // Filled: an older empty report, a newer one with messages in two priorities. Buffering.
    const filled = await device('filled');
    await report(filled, [0, 0, 0, 0], ago(600));
    await report(filled, [1, 0, 0, 2], ago(60));
    // A second filled device, so the oldest report of each device gives a different count than the newest.
    const refilled = await device('refilled');
    await report(refilled, [0, 0, 0, 0], ago(900));
    await report(refilled, [0, 4, 0, 0], ago(30));
    // One report with messages in a single priority. Buffering.
    const single = await device('single');
    await report(single, [0, 0, 0, 3], ago(120));
    // One empty report. Not buffering.
    const empty = await device('empty');
    await report(empty, [0, 0, 0, 0], ago(120));

    // Three of the five are buffering. A plain count of the rows with messages would give four (the older
    // report of the drained device), the oldest report of each device would give two, and a count of the
    // devices would give five.
    expect(await repository.devicesBuffering()).toBe(before + 3);
  });
});
