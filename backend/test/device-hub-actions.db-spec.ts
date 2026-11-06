import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';
import { AccountType, DeviceStatus, HubActionKind } from '@prisma/client';
import { DomainException, ErrorCode } from '../src/common/errors';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { DevicesRepository } from '../src/modules/devices/devices.repository';
import { HubActionRepository } from '../src/modules/devices/dock/hub-action.repository';
import { HubActionService } from '../src/modules/devices/dock/hub-action.service';
import { TransactionalEvents } from '../src/modules/platform/events/emit-after-commit';
import { ContractsRepository } from '../src/modules/rentals/contracts.repository';
import { RentalsCustodyResolver } from '../src/modules/rentals/providers/custody-resolver.provider';

// Capture explicit connection settings before Prisma can load a local .env at construction.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !process.env.DATABASE_DIRECT_URL) {
  throw new Error('test:db requires explicit DATABASE_URL and DATABASE_DIRECT_URL.');
}

// The device hub's action record on Postgres (devices api-design 33 and 34, design section 12.14): the migration
// of device_hub_actions, a factory reset of a returned unit that records the return reset and clears the key, a
// flash that sets the firmware on record, and the typed confirmation of a rented unit. Run only through test:db
// against a migrated disposable database. Fixtures carry a fresh run ID and are never deleted.
describe('HubActionService on Postgres', () => {
  const prisma = new PrismaService({ datasourceUrl: databaseUrl });
  const devices = new DevicesRepository(prisma);
  const service = new HubActionService(
    new HubActionRepository(prisma),
    devices,
    new TransactionalEvents(prisma, new EventEmitter2()),
    // No live contract in these fixtures; the rentals read is covered by its own specs.
    { liveContractsOf: () => Promise.resolve([]) },
    new RentalsCustodyResolver(new ContractsRepository(prisma)),
  );
  const runId = randomUUID();
  let staff: { id: string; roles: string[]; organizationId: null };
  let variantId: string;
  let serial = 0;

  const unit = async (status: DeviceStatus) => {
    serial += 1;
    const nodeNum = BigInt(`0x${randomUUID().slice(0, 8)}`);
    const device = await prisma.device.create({
      data: {
        assetTag: `hub-test-${runId}-${serial}`,
        nodeNum,
        hardwareVariantId: variantId,
        firmwareVersion: '2.7.19-treklink.3',
        acquiredAt: new Date('2026-06-01T00:00:00.000Z'),
        registeredById: staff.id,
        status,
        statusChangedAt: new Date('2026-11-05T00:00:00.000Z'),
        keyVersion: 1,
        provisionedAt: new Date('2026-11-03T02:00:00.000Z'),
      },
    });
    return { id: device.id, assetTag: device.assetTag, nodeNum: Number(nodeNum) };
  };

  beforeAll(async () => {
    await prisma.$connect();
    staff = {
      id: (
        await prisma.user.create({
          data: {
            email: `hub-test-${runId}@example.invalid`,
            fullName: 'Hub test staff',
            accountType: AccountType.TREKLINK,
          },
        })
      ).id,
      roles: ['STAFF'],
      organizationId: null,
    };
    variantId = (
      await prisma.hardwareVariant.create({
        data: {
          code: `hub-test-${runId}`,
          name: 'Hub test variant',
          hasGps: true,
          hasMotionSensor: false,
          mqttCapable: true,
          firmwareBaseline: '2.7.19-treklink.3',
          remainingValueSchedule: [],
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('records the return reset and clears the key when a returned unit out of custody is factory reset', async () => {
    const device = await unit(DeviceStatus.RETURNED);
    const started = await service.start(
      device.id,
      { action: HubActionKind.FACTORY_RESET, nodeNum: device.nodeNum },
      staff,
    );

    const finished = await service.finish(device.id, started.id, { outcome: 'SUCCEEDED' }, staff);

    expect(finished).toMatchObject({
      outcome: 'SUCCEEDED',
      returnReset: true,
      deviceStatus: 'RETURNED',
    });
    const row = await prisma.device.findUniqueOrThrow({ where: { id: device.id } });
    expect(row.keyVersion).toBeNull();
    expect(row.provisionedAt).toBeNull();
    expect(await prisma.deviceReset.count({ where: { deviceId: device.id } })).toBe(1);
  });

  it('clears the provisioning of treklink a274 when the TrekLink defaults are restored (finding of 2026-11-06)', async () => {
    // An AVAILABLE unit still recorded as provisioned with key version 1 (the hub's provisioning of 11-03).
    const device = await unit(DeviceStatus.AVAILABLE);
    const started = await service.start(
      device.id,
      { action: HubActionKind.RESTORE_DEFAULTS, nodeNum: device.nodeNum },
      staff,
    );

    await service.finish(device.id, started.id, { outcome: 'SUCCEEDED' }, staff);

    const row = await prisma.device.findUniqueOrThrow({ where: { id: device.id } });
    expect([row.keyVersion, row.keyOrganizationId, row.provisionedAt]).toEqual([null, null, null]);
    expect(await prisma.deviceReset.count({ where: { deviceId: device.id } })).toBe(0);
  });

  it('sets the firmware on record after a flash of an available unit, and refuses a second finish', async () => {
    const device = await unit(DeviceStatus.AVAILABLE);
    const started = await service.start(
      device.id,
      {
        action: HubActionKind.FIRMWARE_UPDATE,
        nodeNum: device.nodeNum,
        firmwareTo: '2.7.26-treklink.1',
      },
      staff,
    );
    await service.finish(device.id, started.id, { outcome: 'SUCCEEDED' }, staff);

    const row = await prisma.device.findUniqueOrThrow({ where: { id: device.id } });
    expect(row.firmwareVersion).toBe('2.7.26-treklink.1');
    expect(row.keyVersion).toBe(1);
    await expect(
      service.finish(device.id, started.id, { outcome: 'FAILED' }, staff),
    ).rejects.toMatchObject({
      errorCode: ErrorCode.HUB_ACTION_FINISHED,
    });
  });

  it('needs the asset tag typed for a rented unit and then records it', async () => {
    const device = await unit(DeviceStatus.RENTED);
    const refused = service.start(
      device.id,
      { action: HubActionKind.REBOOT, nodeNum: device.nodeNum },
      staff,
    );
    await expect(refused).rejects.toBeInstanceOf(DomainException);
    await expect(refused).rejects.toMatchObject({ errorCode: ErrorCode.CONFIRMATION_REQUIRED });

    const started = await service.start(
      device.id,
      {
        action: HubActionKind.REBOOT,
        nodeNum: device.nodeNum,
        confirmAssetTag: device.assetTag.toUpperCase(),
      },
      staff,
    );
    const failed = await service.finish(
      device.id,
      started.id,
      { outcome: 'FAILED', failure: 'No response.' },
      staff,
    );

    expect(failed).toMatchObject({
      outcome: 'FAILED',
      failure: 'No response.',
      deviceStatus: 'RENTED',
    });
    expect(await prisma.deviceHubAction.count({ where: { deviceId: device.id } })).toBe(1);
  });
});
