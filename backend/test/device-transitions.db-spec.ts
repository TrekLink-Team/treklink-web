import { randomUUID } from 'node:crypto';
import { AccountType, DeviceStatus } from '@prisma/client';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { DevicesRepository } from '../src/modules/devices/devices.repository';
import { DevicesService } from '../src/modules/devices/devices.service';

// Capture explicit connection settings before Prisma can load a local .env at construction.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !process.env.DATABASE_DIRECT_URL) {
  throw new Error('test:db requires explicit DATABASE_URL and DATABASE_DIRECT_URL.');
}

// The moves rentals drives (devices design §2, demo smoke defect 2, 2026-10-30): one transition row
// per unit that moved, in the same transaction, naming the contract; a unit in another status neither
// moves nor gets a row, and a rollback leaves neither. The reservation of approval writes its rows
// after the SKIP LOCKED pick, one per unit taken, with a null actor when SYSTEM approves. Run only
// through test:db against a migrated disposable database. Fixtures carry a fresh run ID and are never
// deleted.
describe('DevicesRepository.moveWithTransitions on Postgres', () => {
  const prisma = new PrismaService({ datasourceUrl: databaseUrl });
  const repository = new DevicesRepository(prisma);
  // reserve reads neither maintenance nor organizations.
  const service = new DevicesService(repository, {} as never, {} as never, {
    custodyAt: () => Promise.resolve(null),
  });
  const at = new Date('2026-10-30T03:00:00.000Z');
  const runId = randomUUID();
  let staffId: string;
  let variantId: string;
  let serial = 0;

  const newVariant = async () => {
    serial += 1;
    return (
      await prisma.hardwareVariant.create({
        data: {
          code: `transitions-test-${runId}-${serial}`,
          name: 'Transitions test variant',
          hasGps: true,
          hasMotionSensor: false,
          mqttCapable: true,
          firmwareBaseline: 'test-only',
          remainingValueSchedule: [],
        },
      })
    ).id;
  };

  const device = async (status: DeviceStatus, hardwareVariantId = variantId) => {
    serial += 1;
    return (
      await prisma.device.create({
        data: {
          assetTag: `transitions-test-${runId}-${serial}`,
          nodeNum: BigInt(`0x${randomUUID().slice(0, 8)}`),
          hardwareVariantId,
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
    variantId = await newVariant();
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

  describe('DevicesService.reserve', () => {
    const contract = () => ({
      contractId: randomUUID(),
      contractCode: `RC-TEST-${runId.slice(0, 8)}`,
      actorId: staffId as string | null,
    });

    it('writes one RESERVED row per unit taken, skipping a unit another transaction holds', async () => {
      const reservationVariant = await newVariant();
      const held = await device(DeviceStatus.AVAILABLE, reservationVariant);
      const free = [
        await device(DeviceStatus.AVAILABLE, reservationVariant),
        await device(DeviceStatus.AVAILABLE, reservationVariant),
      ];
      const move = contract();
      let release!: () => void;
      let locked!: () => void;
      const isLocked = new Promise<void>((resolve) => (locked = resolve));
      // A concurrent approval holds the row lock on `held` until the reservation below is done.
      const holder = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "devices" WHERE "id" = ${held} FOR UPDATE`;
          locked();
          await new Promise<void>((resolve) => (release = resolve));
        },
        { timeout: 15_000 },
      );
      await isLocked;

      let taken: { id: string }[];
      try {
        taken = await prisma.$transaction((tx) =>
          service.reserve({ id: reservationVariant, code: 'TEST' }, 2, at, tx, move),
        );
      } finally {
        release();
        await holder;
      }

      expect(taken.map((unit) => unit.id).sort()).toEqual([...free].sort());
      const rows = await prisma.deviceTransition.findMany({
        where: { deviceId: { in: [held, ...free] } },
      });
      expect(rows.map((entry) => entry.deviceId).sort()).toEqual([...free].sort());
      for (const entry of rows) {
        expect(entry).toMatchObject({
          fromStatus: DeviceStatus.AVAILABLE,
          toStatus: DeviceStatus.RESERVED,
          actorId: staffId,
          reason: 'RESERVED',
          note: move.contractCode,
          refType: 'CONTRACT',
          refId: move.contractId,
          createdAt: at,
        });
      }
      const heldUnit = await prisma.device.findUniqueOrThrow({ where: { id: held } });
      expect(heldUnit.status).toBe(DeviceStatus.AVAILABLE);
    });

    it('writes a null actor when SYSTEM reserves the units', async () => {
      const reservationVariant = await newVariant();
      const unit = await device(DeviceStatus.AVAILABLE, reservationVariant);

      await prisma.$transaction((tx) =>
        service.reserve({ id: reservationVariant, code: 'TEST' }, 1, at, tx, {
          ...contract(),
          actorId: null,
        }),
      );

      const rows = await prisma.deviceTransition.findMany({ where: { deviceId: unit } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        toStatus: DeviceStatus.RESERVED,
        actorId: null,
        reason: 'RESERVED',
      });
    });
  });
});
