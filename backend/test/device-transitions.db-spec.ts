import { randomUUID } from 'node:crypto';
import { AccountType, DeviceStatus } from '@prisma/client';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { DevicesRepository } from '../src/modules/devices/devices.repository';

// Capture explicit connection settings before Prisma can load a local .env at construction.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !process.env.DATABASE_DIRECT_URL) {
  throw new Error('test:db requires explicit DATABASE_URL and DATABASE_DIRECT_URL.');
}

// The moves rentals drives (devices design §2, demo smoke defect 2, 2026-10-30): one transition row
// per unit that moved, in the same transaction, naming the contract; a unit in another status neither
// moves nor gets a row, and a rollback leaves neither. Run only through test:db against a migrated
// disposable database. Fixtures carry a fresh run ID and are never deleted.
describe('DevicesRepository.moveWithTransitions on Postgres', () => {
  const prisma = new PrismaService({ datasourceUrl: databaseUrl });
  const repository = new DevicesRepository(prisma);
  const at = new Date('2026-10-30T03:00:00.000Z');
  const runId = randomUUID();
  let staffId: string;
  let variantId: string;
  let serial = 0;

  const device = async (status: DeviceStatus) => {
    serial += 1;
    return (
      await prisma.device.create({
        data: {
          assetTag: `transitions-test-${runId}-${serial}`,
          nodeNum: BigInt(`0x${randomUUID().slice(0, 8)}`),
          hardwareVariantId: variantId,
          firmwareVersion: 'test-only',
          acquiredAt: at,
          registeredById: staffId,
          status,
        },
      })
    ).id;
  };

  const row = {
    actorId: '',
    reason: 'HANDED_OVER',
    note: 'RC-2026-0099',
    refType: 'CONTRACT',
    refId: randomUUID(),
  };

  beforeAll(async () => {
    await prisma.$connect();
    staffId = (
      await prisma.user.create({
        data: {
          email: `transitions-test-${runId}@example.invalid`,
          fullName: 'Transitions test staff',
          accountType: AccountType.TREKLINK,
        },
      })
    ).id;
    row.actorId = staffId;
    variantId = (
      await prisma.hardwareVariant.create({
        data: {
          code: `transitions-test-${runId}`,
          name: 'Transitions test variant',
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
    await prisma.$disconnect();
  });

  it('moves only the units in the source status and writes one row for each of them', async () => {
    const reserved = await device(DeviceStatus.RESERVED);
    const available = await device(DeviceStatus.AVAILABLE);

    const moved = await prisma.$transaction((tx) =>
      repository.moveWithTransitions(
        [reserved, available],
        DeviceStatus.RESERVED,
        DeviceStatus.RENTED,
        at,
        tx,
        row,
      ),
    );

    expect(moved).toEqual([reserved]);
    const units = await prisma.device.findMany({
      where: { id: { in: [reserved, available] } },
      select: { id: true, status: true },
    });
    expect(Object.fromEntries(units.map((unit) => [unit.id, unit.status]))).toEqual({
      [reserved]: DeviceStatus.RENTED,
      [available]: DeviceStatus.AVAILABLE,
    });
    const rows = await prisma.deviceTransition.findMany({
      where: { deviceId: { in: [reserved, available] } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      deviceId: reserved,
      fromStatus: DeviceStatus.RESERVED,
      toStatus: DeviceStatus.RENTED,
      actorId: staffId,
      reason: 'HANDED_OVER',
      note: 'RC-2026-0099',
      refType: 'CONTRACT',
      refId: row.refId,
      createdAt: at,
    });
  });

  it('leaves neither the move nor the row when the transaction rolls back', async () => {
    const reserved = await device(DeviceStatus.RESERVED);

    await expect(
      prisma.$transaction(async (tx) => {
        await repository.moveWithTransitions(
          [reserved],
          DeviceStatus.RESERVED,
          DeviceStatus.AVAILABLE,
          at,
          tx,
          { ...row, reason: 'RELEASED' },
        );
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');

    const unit = await prisma.device.findUniqueOrThrow({ where: { id: reserved } });
    expect(unit.status).toBe(DeviceStatus.RESERVED);
    await expect(prisma.deviceTransition.count({ where: { deviceId: reserved } })).resolves.toBe(0);
  });
});
