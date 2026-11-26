import { DeviceStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DevicesRepository, PROVISIONED_SELECT } from './devices.repository';

// devices task 1.1 and its growth through tasks 2.1 to 2.8: the reads, the projection and the
// provisioning writes of DevicesRepository, from `panelOptions` to `provisioning`. `projectIfNewer` is
// in devices.repository.projection.spec.ts. This file asserts the where clauses, the ordering, the
// `version` bump on updates, the raw SQL of the reservation, the client each call goes through and the
// mapping of the returned rows.

const AT = new Date('2026-11-20T03:00:00.000Z');
const IDENTITY = { id: true, assetTag: true, nodeNum: true, status: true };

const aClient = () => ({
  $queryRaw: jest.fn().mockResolvedValue([]),
  device: {
    findMany: jest.fn().mockResolvedValue([]),
    findUnique: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockResolvedValue({ id: 'd-1' }),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    groupBy: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
  },
  hardwareVariant: {
    findMany: jest.fn().mockResolvedValue([]),
  },
  deviceProvisioning: {
    create: jest.fn().mockResolvedValue({ id: 'dp-1' }),
  },
});

// The SQL text of a tagged-template call, the placeholders written as `?`.
const sqlOf = (mock: jest.Mock, call = 0) =>
  (mock.mock.calls[call] as [TemplateStringsArray])[0].join('?').replace(/\s+/g, ' ').trim();
const valuesOf = (mock: jest.Mock, call = 0) => (mock.mock.calls[call] as unknown[]).slice(1);

describe('DevicesRepository reads, projection and provisioning', () => {
  let prisma: ReturnType<typeof aClient>;
  let tx: ReturnType<typeof aClient>;
  let repository: DevicesRepository;

  beforeEach(() => {
    prisma = aClient();
    tx = aClient();
    repository = new DevicesRepository(prisma as unknown as PrismaService);
  });

  describe('panelOptions (demo design section 11, D-110)', () => {
    it('lists the usable units by asset tag, at most 200, with their version', async () => {
      const rows = [
        { id: 'd-1', assetTag: 'TL-001', status: 'AVAILABLE', version: 3, nodeNum: 1n },
      ];
      prisma.device.findMany.mockResolvedValue(rows);
      await expect(repository.panelOptions()).resolves.toBe(rows);
      expect(prisma.device.findMany).toHaveBeenCalledWith({
        where: { status: { in: ['AVAILABLE', 'MAINTENANCE', 'RENTED'] } },
        select: { id: true, assetTag: true, status: true, version: true, nodeNum: true },
        orderBy: { assetTag: 'asc' },
        take: 200,
      });
    });
  });

  describe('findByAssetTag (D-088)', () => {
    it('reads the identity and version by asset tag, through the default client', async () => {
      const row = { id: 'd-1', assetTag: 'TL-001', nodeNum: 1n, status: 'AVAILABLE', version: 2 };
      prisma.device.findUnique.mockResolvedValue(row);
      await expect(repository.findByAssetTag('TL-001')).resolves.toBe(row);
      expect(prisma.device.findUnique).toHaveBeenCalledWith({
        where: { assetTag: 'TL-001' },
        select: { ...IDENTITY, version: true },
      });
    });

    it('reads through the transaction client when one is given', async () => {
      await expect(repository.findByAssetTag('TL-404', tx as never)).resolves.toBeNull();
      expect(tx.device.findUnique).toHaveBeenCalledTimes(1);
      expect(prisma.device.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('setServiceDue (D-088)', () => {
    it('writes the service date and bumps the version, leaving the status alone', async () => {
      await expect(repository.setServiceDue('d-1', AT)).resolves.toBeUndefined();
      expect(prisma.device.update).toHaveBeenCalledWith({
        where: { id: 'd-1' },
        data: { serviceDueAt: AT, version: { increment: 1 } },
      });
    });

    it('writes through the transaction client when one is given', async () => {
      await repository.setServiceDue('d-1', AT, tx as never);
      expect(tx.device.update).toHaveBeenCalledTimes(1);
      expect(prisma.device.update).not.toHaveBeenCalled();
    });
  });

  describe('findByNodeNum', () => {
    it('reads the identity by node number', async () => {
      const row = { id: 'd-1', assetTag: 'TL-001', nodeNum: 42n, status: 'RENTED' };
      prisma.device.findUnique.mockResolvedValue(row);
      await expect(repository.findByNodeNum(42n)).resolves.toBe(row);
      expect(prisma.device.findUnique).toHaveBeenCalledWith({
        where: { nodeNum: 42n },
        select: IDENTITY,
      });
    });

    it('reads through the transaction client when one is given', async () => {
      await repository.findByNodeNum(42n, tx as never);
      expect(tx.device.findUnique).toHaveBeenCalledTimes(1);
      expect(prisma.device.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('projections (REQ-EVT-08)', () => {
    it('reads the projection by asset tag and flattens the variant into variantCode', async () => {
      prisma.device.findMany.mockResolvedValue([
        {
          id: 'd-1',
          assetTag: 'TL-001',
          nodeNum: 1n,
          status: 'RENTED',
          lastSeenAt: AT,
          batteryPct: 80,
          lastLatitude: 11.5,
          lastLongitude: 108.5,
          lastPositionAt: AT,
          lastBatteryAt: null,
          hardwareVariant: { code: 'TL-T1000' },
        },
      ]);
      const ids = ['d-1', 'd-2'] as const;
      const result = await repository.projections(ids);
      expect(result).toEqual([
        {
          id: 'd-1',
          assetTag: 'TL-001',
          nodeNum: 1n,
          status: 'RENTED',
          lastSeenAt: AT,
          batteryPct: 80,
          lastLatitude: 11.5,
          lastLongitude: 108.5,
          lastPositionAt: AT,
          lastBatteryAt: null,
          variantCode: 'TL-T1000',
        },
      ]);
      expect(result[0]).not.toHaveProperty('hardwareVariant');
      const [args] = prisma.device.findMany.mock.calls[0] as [{ where: { id: { in: string[] } } }];
      expect(args).toEqual({
        where: { id: { in: ['d-1', 'd-2'] } },
        select: {
          ...IDENTITY,
          lastSeenAt: true,
          batteryPct: true,
          lastLatitude: true,
          lastLongitude: true,
          lastPositionAt: true,
          lastBatteryAt: true,
          hardwareVariant: { select: { code: true } },
        },
        orderBy: { assetTag: 'asc' },
      });
      expect(args.where.id.in).not.toBe(ids);
    });

    it('reads through the transaction client when one is given', async () => {
      await expect(repository.projections([], tx as never)).resolves.toEqual([]);
      expect(tx.device.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.device.findMany).not.toHaveBeenCalled();
    });
  });

  describe('findValuation', () => {
    it('reads the acquisition date and the remaining-value schedule of the variant', async () => {
      const row = { acquiredAt: AT, hardwareVariant: { remainingValueSchedule: [] } };
      prisma.device.findUnique.mockResolvedValue(row);
      await expect(repository.findValuation('d-1')).resolves.toBe(row);
      expect(prisma.device.findUnique).toHaveBeenCalledWith({
        where: { id: 'd-1' },
        select: { acquiredAt: true, hardwareVariant: { select: { remainingValueSchedule: true } } },
      });
      await repository.findValuation('d-1', tx as never);
      expect(tx.device.findUnique).toHaveBeenCalledTimes(1);
    });
  });

  describe('reserveAvailable (BR-03)', () => {
    const picked = [
      { id: 'd-1', assetTag: 'TL-001' },
      { id: 'd-2', assetTag: 'TL-002' },
    ];

    it('locks the oldest AVAILABLE units of the variant, skipping locked rows', async () => {
      tx.$queryRaw.mockResolvedValue(picked);
      await repository.reserveAvailable('hv-1', 2, AT, tx as never);
      expect(sqlOf(tx.$queryRaw)).toBe(
        'SELECT "id", "assetTag" FROM "devices" ' +
          `WHERE "hardwareVariantId" = ? AND "status" = 'AVAILABLE'::"DeviceStatus" ? ` +
          'ORDER BY "statusChangedAt" ASC, "assetTag" ASC LIMIT ? FOR UPDATE SKIP LOCKED',
      );
      const [variantId, choice, quantity] = valuesOf(tx.$queryRaw);
      expect(variantId).toBe('hv-1');
      expect(choice).toBe(Prisma.empty);
      expect(quantity).toBe(2);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('limits the pick to the named units when deviceIds is given', async () => {
      tx.$queryRaw.mockResolvedValue(picked);
      await repository.reserveAvailable('hv-1', 2, AT, tx as never, ['d-1', 'd-2']);
      const [, choice] = valuesOf(tx.$queryRaw) as [unknown, Prisma.Sql];
      expect(choice.sql).toBe('AND "id" IN (?,?)');
      expect(choice.values).toEqual(['d-1', 'd-2']);
    });

    it('moves the picked units to RESERVED with a version bump when all were found', async () => {
      tx.$queryRaw.mockResolvedValue(picked);
      await expect(repository.reserveAvailable('hv-1', 2, AT, tx as never)).resolves.toBe(picked);
      expect(tx.device.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['d-1', 'd-2'] } },
        data: { status: DeviceStatus.RESERVED, statusChangedAt: AT, version: { increment: 1 } },
      });
    });

    it('writes nothing and answers the short pick when fewer units were free', async () => {
      tx.$queryRaw.mockResolvedValue([picked[0]]);
      await expect(repository.reserveAvailable('hv-1', 2, AT, tx as never)).resolves.toEqual([
        picked[0],
      ]);
      expect(tx.device.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('inServiceCounts (monitoring api-design 08)', () => {
    it('groups the units in the given statuses by variant and maps the counts', async () => {
      prisma.device.groupBy.mockResolvedValue([
        { hardwareVariantId: 'hv-1', _count: { _all: 3 } },
        { hardwareVariantId: 'hv-2', _count: { _all: 1 } },
      ]);
      const statuses = [DeviceStatus.AVAILABLE, DeviceStatus.RENTED] as const;
      await expect(repository.inServiceCounts(statuses)).resolves.toEqual([
        { hardwareVariantId: 'hv-1', units: 3 },
        { hardwareVariantId: 'hv-2', units: 1 },
      ]);
      const [args] = prisma.device.groupBy.mock.calls[0] as [
        { where: { status: { in: DeviceStatus[] } } },
      ];
      expect(args).toEqual({
        by: ['hardwareVariantId'],
        where: { status: { in: ['AVAILABLE', 'RENTED'] } },
        _count: { _all: true },
      });
      expect(args.where.status.in).not.toBe(statuses);
    });

    it('groups through the transaction client when one is given', async () => {
      await repository.inServiceCounts([], tx as never);
      expect(tx.device.groupBy).toHaveBeenCalledTimes(1);
      expect(prisma.device.groupBy).not.toHaveBeenCalled();
    });
  });

  describe('availability', () => {
    it('lists every active variant by code, zero where no unit is AVAILABLE', async () => {
      prisma.hardwareVariant.findMany.mockResolvedValue([
        { id: 'hv-1', code: 'A' },
        { id: 'hv-2', code: 'B' },
      ]);
      prisma.device.groupBy.mockResolvedValue([{ hardwareVariantId: 'hv-2', _count: { _all: 4 } }]);
      await expect(repository.availability(undefined)).resolves.toEqual([
        { hardwareVariantId: 'hv-1', code: 'A', available: 0 },
        { hardwareVariantId: 'hv-2', code: 'B', available: 4 },
      ]);
      expect(prisma.hardwareVariant.findMany).toHaveBeenCalledWith({
        where: { isActive: true },
        orderBy: { code: 'asc' },
        select: { id: true, code: true },
      });
      expect(prisma.device.groupBy).toHaveBeenCalledWith({
        by: ['hardwareVariantId'],
        where: { status: DeviceStatus.AVAILABLE },
        _count: { _all: true },
      });
    });

    it('narrows both reads to one variant, active or not, when one is named', async () => {
      await repository.availability('hv-1', tx as never);
      expect(tx.hardwareVariant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'hv-1' } }),
      );
      expect(tx.device.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: DeviceStatus.AVAILABLE, hardwareVariantId: 'hv-1' },
        }),
      );
      expect(prisma.hardwareVariant.findMany).not.toHaveBeenCalled();
      expect(prisma.device.groupBy).not.toHaveBeenCalled();
    });
  });

  describe('countAvailable', () => {
    it('counts the AVAILABLE units of one variant', async () => {
      prisma.device.count.mockResolvedValue(5);
      await expect(repository.countAvailable('hv-1')).resolves.toBe(5);
      expect(prisma.device.count).toHaveBeenCalledWith({
        where: { hardwareVariantId: 'hv-1', status: DeviceStatus.AVAILABLE },
      });
      await repository.countAvailable('hv-1', tx as never);
      expect(tx.device.count).toHaveBeenCalledTimes(1);
    });
  });

  describe('id lookups', () => {
    it('tags: id and asset tag of the given units, on a copy of the id list', async () => {
      const ids = ['d-1'] as const;
      await repository.tags(ids);
      const [args] = prisma.device.findMany.mock.calls[0] as [{ where: { id: { in: string[] } } }];
      expect(args).toEqual({
        where: { id: { in: ['d-1'] } },
        select: { id: true, assetTag: true },
      });
      expect(args.where.id.in).not.toBe(ids);
      await repository.tags(ids, tx as never);
      expect(tx.device.findMany).toHaveBeenCalledTimes(1);
    });

    it('nodeNums: id and node number of the given units', async () => {
      await repository.nodeNums(['d-1', 'd-2']);
      expect(prisma.device.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['d-1', 'd-2'] } },
        select: { id: true, nodeNum: true },
      });
      await repository.nodeNums(['d-1'], tx as never);
      expect(tx.device.findMany).toHaveBeenCalledTimes(1);
    });

    it('identity: id, asset tag and node number of one unit', async () => {
      const row = { id: 'd-1', assetTag: 'TL-001', nodeNum: 1n };
      prisma.device.findUnique.mockResolvedValue(row);
      await expect(repository.identity('d-1')).resolves.toBe(row);
      expect(prisma.device.findUnique).toHaveBeenCalledWith({
        where: { id: 'd-1' },
        select: { id: true, assetTag: true, nodeNum: true },
      });
      await repository.identity('d-1', tx as never);
      expect(tx.device.findUnique).toHaveBeenCalledTimes(1);
    });

    it('handoverUnits: the facts the handover note prints, with the value schedule', async () => {
      await repository.handoverUnits(['d-1']);
      expect(prisma.device.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['d-1'] } },
        select: {
          id: true,
          assetTag: true,
          nodeNum: true,
          keyVersion: true,
          firmwareVersion: true,
          acquiredAt: true,
          hardwareVariant: { select: { code: true, remainingValueSchedule: true } },
        },
      });
      await repository.handoverUnits(['d-1'], tx as never);
      expect(tx.device.findMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('recordProvisioning (D-021)', () => {
    const provisioning = {
      deviceId: 'd-1',
      organizationId: 'org-1',
      keyVersion: 4,
      actorId: 'u-1',
    };

    it('appends the provisioning row, then stamps the key on the device', async () => {
      const updated = { id: 'd-1', keyVersion: 4 };
      tx.device.update.mockResolvedValue(updated);
      await expect(repository.recordProvisioning(provisioning, AT, tx as never)).resolves.toBe(
        updated,
      );
      expect(tx.deviceProvisioning.create).toHaveBeenCalledWith({
        data: {
          deviceId: 'd-1',
          organizationId: 'org-1',
          keyVersion: 4,
          provisionedById: 'u-1',
          createdAt: AT,
        },
      });
      expect(tx.device.update).toHaveBeenCalledWith({
        where: { id: 'd-1' },
        data: { keyVersion: 4, keyOrganizationId: 'org-1', provisionedAt: AT },
        select: PROVISIONED_SELECT,
      });
      expect(tx.deviceProvisioning.create.mock.invocationCallOrder[0]).toBeLessThan(
        tx.device.update.mock.invocationCallOrder[0],
      );
      expect(prisma.deviceProvisioning.create).not.toHaveBeenCalled();
      expect(prisma.device.update).not.toHaveBeenCalled();
    });
  });

  describe('clearProvisioning (rentals api-design 19)', () => {
    it('clears the key, the organization and the time, and bumps the version', async () => {
      const cleared = { id: 'd-1', keyVersion: null };
      tx.device.update.mockResolvedValue(cleared);
      await expect(repository.clearProvisioning('d-1', tx as never)).resolves.toBe(cleared);
      expect(tx.device.update).toHaveBeenCalledWith({
        where: { id: 'd-1' },
        data: {
          keyVersion: null,
          keyOrganizationId: null,
          provisionedAt: null,
          version: { increment: 1 },
        },
        select: PROVISIONED_SELECT,
      });
      expect(tx.deviceProvisioning.create).not.toHaveBeenCalled();
    });
  });

  describe('provisioning', () => {
    it('reads the provisioned fields of the given units', async () => {
      const rows = [{ id: 'd-1' }];
      prisma.device.findMany.mockResolvedValue(rows);
      await expect(repository.provisioning(['d-1'])).resolves.toBe(rows);
      expect(prisma.device.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['d-1'] } },
        select: PROVISIONED_SELECT,
      });
      await repository.provisioning(['d-1'], tx as never);
      expect(tx.device.findMany).toHaveBeenCalledTimes(1);
    });

    it('selects the key fields and the battery, no version', () => {
      expect(PROVISIONED_SELECT).toEqual({
        id: true,
        assetTag: true,
        status: true,
        keyVersion: true,
        keyOrganizationId: true,
        provisionedAt: true,
        batteryPct: true,
      });
    });
  });
});
