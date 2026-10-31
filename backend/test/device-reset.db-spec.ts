import { HttpStatus } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AccountType, DeviceStatus } from '@prisma/client';
import { DomainException, ErrorCode } from '../src/common/errors';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { DevicesRepository } from '../src/modules/devices/devices.repository';
import { DevicesService } from '../src/modules/devices/devices.service';
import { ContractsRepository } from '../src/modules/rentals/contracts.repository';
import { RentalsCustodyResolver } from '../src/modules/rentals/providers/custody-resolver.provider';

// Capture explicit connection settings before Prisma can load a local .env at construction.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !process.env.DATABASE_DIRECT_URL) {
  throw new Error('test:db requires explicit DATABASE_URL and DATABASE_DIRECT_URL.');
}

// The reset of a returned unit (devices api-design 10) and what the return counter reads back
// (rentals api-design 03 devices[]): two counters resetting the same return at once record one reset,
// the other is 409 ALREADY_RESET; a reset is shown against the return it belongs to, bounded by the
// unit's next return. Run only through test:db against a migrated disposable database. Fixtures carry
// a fresh run ID and are never deleted.
describe('DevicesService.reset and returnChecks on Postgres', () => {
  const prisma = new PrismaService({ datasourceUrl: databaseUrl });
  const repository = new DevicesRepository(prisma);
  // reset and returnChecks read neither maintenance nor organizations; custody is the real rentals
  // provider, so a unit with no open contract row resets as before.
  const service = new DevicesService(
    repository,
    {} as never,
    {} as never,
    new RentalsCustodyResolver(new ContractsRepository(prisma)),
  );
  const steps = { keyRemoved: true, nodeDbCleared: true, ownerCleared: true };
  const runId = randomUUID();
  let staffId: string;
  let variantId: string;
  let serial = 0;

  const returnedDevice = async (statusChangedAt: Date) => {
    serial += 1;
    return (
      await prisma.device.create({
        data: {
          assetTag: `reset-test-${runId}-${serial}`,
          nodeNum: BigInt(`0x${randomUUID().slice(0, 8)}`),
          hardwareVariantId: variantId,
          firmwareVersion: 'test-only',
          acquiredAt: statusChangedAt,
          registeredById: staffId,
          status: DeviceStatus.RETURNED,
          statusChangedAt,
        },
      })
    ).id;
  };

  const checkedIn = (deviceId: string, at: Date) =>
    prisma.deviceTransition.create({
      data: {
        deviceId,
        fromStatus: DeviceStatus.RENTED,
        toStatus: DeviceStatus.RETURNED,
        actorId: staffId,
        reason: 'CHECKED_IN',
        refType: 'CONTRACT',
        refId: randomUUID(),
        createdAt: at,
      },
    });

  beforeAll(async () => {
    await prisma.$connect();
    staffId = (
      await prisma.user.create({
        data: {
          email: `reset-test-${runId}@example.invalid`,
          fullName: 'Reset test staff',
          accountType: AccountType.TREKLINK,
        },
      })
    ).id;
    variantId = (
      await prisma.hardwareVariant.create({
        data: {
          code: `reset-test-${runId}`,
          name: 'Reset test variant',
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

  it('records one of two concurrent resets of one return and refuses the other with 409 ALREADY_RESET', async () => {
    const returnedAt = new Date('2026-10-30T03:00:00.000Z');
    const deviceId = await returnedDevice(returnedAt);
    const at = new Date('2026-10-30T03:10:00.000Z');

    const outcomes = await Promise.allSettled(
      [0, 1].map(() =>
        prisma.$transaction((tx) => service.reset(deviceId, steps, staffId, at, tx)),
      ),
    );

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const refused = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
    );
    expect(refused).toHaveLength(1);
    const error = refused[0].reason as DomainException;
    expect(error).toBeInstanceOf(DomainException);
    expect(error.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(JSON.stringify(error.getResponse())).toContain(ErrorCode.ALREADY_RESET);
    await expect(prisma.deviceReset.count({ where: { deviceId } })).resolves.toBe(1);
  });

  it('shows each reset against its own return, bounded by the next return of the unit', async () => {
    const firstReturn = new Date('2026-10-01T03:00:00.000Z');
    const secondReturn = new Date('2026-10-20T03:00:00.000Z');
    const deviceId = await returnedDevice(secondReturn);
    await checkedIn(deviceId, firstReturn);
    await checkedIn(deviceId, secondReturn);
    // The first return was never reset at the counter; the second was.
    const secondReset = new Date('2026-10-20T03:05:00.000Z');
    await prisma.$transaction((tx) => service.reset(deviceId, steps, staffId, secondReset, tx));

    const checks = await service.returnChecks([
      { contractDeviceId: 'first', deviceId, checkedInAt: firstReturn },
      { contractDeviceId: 'second', deviceId, checkedInAt: secondReturn },
    ]);

    expect(checks.get('first')?.resetAt).toBeNull();
    expect(checks.get('second')?.resetAt).toEqual(secondReset);
  });
});
