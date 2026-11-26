import { DeviceStatus, LossCaseState } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  DevicesRepository,
  LIST_SELECT,
  UNIT_SELECT,
  VARIANT_SELECT,
  VARIANT_SUMMARY_SELECT,
} from './devices.repository';

// devices design section 2 and tasks 2.1 to 2.8: the status moves, the variant catalog, the fleet
// page, the loss-case checks and the return, reset and disposal records of DevicesRepository, from
// `moveWithTransitions` to `insertDisposal`. The lifecycle rules are in the service specs; this file
// asserts the where clauses, the ordering, the paging, the `version` bump on updates, the raw lock,
// the client each call goes through and the mapping of the returned rows.

const AT = new Date('2026-11-20T03:00:00.000Z');
const EARLIER = new Date('2026-11-19T03:00:00.000Z');
const OPEN_STATES = [LossCaseState.REPORTED, LossCaseState.SEARCHING, LossCaseState.CONFIRMED];

const aClient = () => ({
  $queryRaw: jest.fn().mockResolvedValue([]),
  $transaction: jest.fn((calls: Promise<unknown>[]) => Promise.all(calls)),
  device: {
    findMany: jest.fn().mockResolvedValue([]),
    findUnique: jest.fn().mockResolvedValue(null),
    findFirst: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ id: 'd-1' }),
    update: jest.fn().mockResolvedValue({ id: 'd-1' }),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    updateManyAndReturn: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
  },
  deviceTransition: {
    createMany: jest.fn().mockResolvedValue({ count: 0 }),
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue(null),
  },
  deviceReset: {
    create: jest.fn().mockResolvedValue({ id: 'dr-1' }),
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue(null),
  },
  deviceDisposal: {
    create: jest.fn().mockResolvedValue({ id: 'dd-1' }),
  },
  hardwareVariant: {
    findMany: jest.fn().mockResolvedValue([]),
    findUnique: jest.fn().mockResolvedValue(null),
  },
  lossCase: {
    count: jest.fn().mockResolvedValue(0),
    findMany: jest.fn().mockResolvedValue([]),
    findUnique: jest.fn().mockResolvedValue(null),
  },
  inspection: {
    findUnique: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
  },
});

const sqlOf = (mock: jest.Mock, call = 0) =>
  (mock.mock.calls[call] as [TemplateStringsArray])[0].join('?').replace(/\s+/g, ' ').trim();

const context = { actorId: 'u-1', reason: 'CHECK_IN', refType: 'CONTRACT', refId: 'c-1' };

describe('DevicesRepository transitions, catalog, paging, loss and returns', () => {
  let prisma: ReturnType<typeof aClient>;
  let tx: ReturnType<typeof aClient>;
  let repository: DevicesRepository;

  beforeEach(() => {
    prisma = aClient();
    tx = aClient();
    repository = new DevicesRepository(prisma as unknown as PrismaService);
  });

  describe('moveWithTransitions', () => {
    it('moves only the units still in `from`, bumps the version and writes a row per moved unit', async () => {
      tx.device.updateManyAndReturn.mockResolvedValue([{ id: 'd-1' }]);
      const ids = ['d-1', 'd-2'] as const;
      await expect(
        repository.moveWithTransitions(
          ids,
          DeviceStatus.RENTED,
          DeviceStatus.RETURNED,
          AT,
          tx as never,
          context,
        ),
      ).resolves.toEqual(['d-1']);
      const [args] = tx.device.updateManyAndReturn.mock.calls[0] as [
        { where: { id: { in: string[] } } },
      ];
      expect(args).toEqual({
        where: { id: { in: ['d-1', 'd-2'] }, status: DeviceStatus.RENTED },
        data: { status: DeviceStatus.RETURNED, statusChangedAt: AT, version: { increment: 1 } },
        select: { id: true },
      });
      expect(args.where.id.in).not.toBe(ids);
      expect(tx.deviceTransition.createMany).toHaveBeenCalledWith({
        data: [
          {
            deviceId: 'd-1',
            fromStatus: DeviceStatus.RENTED,
            toStatus: DeviceStatus.RETURNED,
            ...context,
            createdAt: AT,
          },
        ],
      });
      expect(prisma.device.updateManyAndReturn).not.toHaveBeenCalled();
    });

    it('writes no transition row when no unit was still in `from`', async () => {
      await expect(
        repository.moveWithTransitions(
          ['d-1'],
          DeviceStatus.RENTED,
          DeviceStatus.RETURNED,
          AT,
          tx as never,
          context,
        ),
      ).resolves.toEqual([]);
      expect(tx.deviceTransition.createMany).not.toHaveBeenCalled();
    });

    it('touches nothing for an empty id list', async () => {
      await expect(
        repository.moveWithTransitions(
          [],
          DeviceStatus.RENTED,
          DeviceStatus.RETURNED,
          AT,
          tx as never,
          context,
        ),
      ).resolves.toEqual([]);
      expect(tx.device.updateManyAndReturn).not.toHaveBeenCalled();
    });
  });

  describe('insertTransitions', () => {
    it('writes one row per unit with the context and the time', async () => {
      await repository.insertTransitions(
        ['d-1', 'd-2'],
        DeviceStatus.AVAILABLE,
        DeviceStatus.RESERVED,
        AT,
        tx as never,
        { actorId: null, reason: 'APPROVAL', note: 'n' },
      );
      expect(tx.deviceTransition.createMany).toHaveBeenCalledWith({
        data: ['d-1', 'd-2'].map((deviceId) => ({
          deviceId,
          fromStatus: DeviceStatus.AVAILABLE,
          toStatus: DeviceStatus.RESERVED,
          actorId: null,
          reason: 'APPROVAL',
          note: 'n',
          createdAt: AT,
        })),
      });
    });

    it('writes nothing for an empty id list', async () => {
      await repository.insertTransitions(
        [],
        DeviceStatus.AVAILABLE,
        DeviceStatus.RESERVED,
        AT,
        tx as never,
        context,
      );
      expect(tx.deviceTransition.createMany).not.toHaveBeenCalled();
    });
  });

  describe('moveStatus', () => {
    it('moves the units still in `from`, bumps the version and answers the count', async () => {
      tx.device.updateMany.mockResolvedValue({ count: 2 });
      await expect(
        repository.moveStatus(
          ['d-1', 'd-2'],
          DeviceStatus.RESERVED,
          DeviceStatus.RENTED,
          AT,
          tx as never,
        ),
      ).resolves.toBe(2);
      expect(tx.device.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['d-1', 'd-2'] }, status: DeviceStatus.RESERVED },
        data: { status: DeviceStatus.RENTED, statusChangedAt: AT, version: { increment: 1 } },
      });
      expect(prisma.device.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('variant catalog', () => {
    it('variants: the active ones by code, the summary plus isActive', async () => {
      const rows = [{ id: 'hv-1' }];
      prisma.hardwareVariant.findMany.mockResolvedValue(rows);
      await expect(repository.variants(true)).resolves.toBe(rows);
      expect(prisma.hardwareVariant.findMany).toHaveBeenCalledWith({
        where: { isActive: true },
        orderBy: { code: 'asc' },
        select: { ...VARIANT_SUMMARY_SELECT, isActive: true },
      });
    });

    it('variants: every variant when activeOnly is false, through the given client', async () => {
      await repository.variants(false, tx as never);
      expect(tx.hardwareVariant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
      expect(prisma.hardwareVariant.findMany).not.toHaveBeenCalled();
    });

    it('variantCatalog: the full variant with its device count, by code', async () => {
      await repository.variantCatalog(true);
      expect(prisma.hardwareVariant.findMany).toHaveBeenCalledWith({
        where: { isActive: true },
        orderBy: { code: 'asc' },
        select: { ...VARIANT_SELECT, _count: { select: { devices: true } } },
      });
      await repository.variantCatalog(false, tx as never);
      expect(tx.hardwareVariant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    it('findVariant: one variant by id with VARIANT_SELECT', async () => {
      const row = { id: 'hv-1' };
      prisma.hardwareVariant.findUnique.mockResolvedValue(row);
      await expect(repository.findVariant('hv-1')).resolves.toBe(row);
      expect(prisma.hardwareVariant.findUnique).toHaveBeenCalledWith({
        where: { id: 'hv-1' },
        select: VARIANT_SELECT,
      });
      await repository.findVariant('hv-1', tx as never);
      expect(tx.hardwareVariant.findUnique).toHaveBeenCalledTimes(1);
    });
  });

  describe('registration (devices api-design 05, REQ-ERR-01)', () => {
    it('findRegistered: matches the asset tag without case, or the node number', async () => {
      await repository.findRegistered('tl-001', 42n);
      expect(prisma.device.findFirst).toHaveBeenCalledWith({
        where: { OR: [{ assetTag: { equals: 'tl-001', mode: 'insensitive' } }, { nodeNum: 42n }] },
        select: { assetTag: true, nodeNum: true },
      });
      await repository.findRegistered('tl-001', 42n, tx as never);
      expect(tx.device.findFirst).toHaveBeenCalledTimes(1);
    });

    it('insertDevice: creates the unit IN_INTAKE through the transaction', async () => {
      const data = {
        assetTag: 'TL-001',
        nodeNum: 42n,
        hardwareVariantId: 'hv-1',
        firmwareVersion: '2.5.0',
        acquiredAt: EARLIER,
        registeredById: 'u-1',
        statusChangedAt: AT,
      };
      const created = { id: 'd-1' };
      tx.device.create.mockResolvedValue(created);
      await expect(repository.insertDevice(data, tx as never)).resolves.toBe(created);
      expect(tx.device.create).toHaveBeenCalledWith({
        data: { ...data, status: DeviceStatus.IN_INTAKE },
        select: LIST_SELECT,
      });
      expect(prisma.device.create).not.toHaveBeenCalled();
    });
  });

  describe('page (devices api-design 06)', () => {
    it('reads one page and the total in one transaction, by asset tag without a sort', async () => {
      const rows = [{ id: 'd-1' }];
      prisma.device.findMany.mockResolvedValue(rows);
      prisma.device.count.mockResolvedValue(31);
      await expect(repository.page({}, 20, 10)).resolves.toEqual([rows, 31]);
      expect(prisma.device.findMany).toHaveBeenCalledWith({
        where: {},
        select: LIST_SELECT,
        orderBy: [{ assetTag: 'asc' }],
        skip: 20,
        take: 10,
      });
      expect(prisma.device.count).toHaveBeenCalledWith({ where: {} });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect((prisma.$transaction.mock.calls[0] as [unknown[]])[0]).toHaveLength(2);
    });

    it('filters by status, variant and a literal asset tag search, the same in both reads', async () => {
      await repository.page(
        {
          statuses: [DeviceStatus.AVAILABLE, DeviceStatus.RENTED],
          hardwareVariantId: 'hv-1',
          q: 'TL_1%',
        },
        0,
        20,
      );
      const where = {
        status: { in: [DeviceStatus.AVAILABLE, DeviceStatus.RENTED] },
        hardwareVariantId: 'hv-1',
        assetTag: { contains: 'TL\\_1\\%', mode: 'insensitive' },
      };
      expect(prisma.device.findMany).toHaveBeenCalledWith(expect.objectContaining({ where }));
      expect(prisma.device.count).toHaveBeenCalledWith({ where });
    });

    it('ignores an empty status list', async () => {
      await repository.page({ statuses: [] }, 0, 20);
      expect(prisma.device.count).toHaveBeenCalledWith({ where: {} });
    });

    it('breaks a tie on the requested sort by id, in the same direction (W26)', async () => {
      await repository.page({}, 0, 20, { field: 'assetTag', order: 'desc' });
      expect(prisma.device.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: [{ assetTag: 'desc' }, { id: 'desc' }] }),
      );
    });
  });

  describe('lockUnit', () => {
    it('locks the row FOR UPDATE, then reads the unit, both in the transaction', async () => {
      const unit = { id: 'd-1', version: 3 };
      tx.device.findUnique.mockResolvedValue(unit);
      await expect(repository.lockUnit('d-1', tx as never)).resolves.toBe(unit);
      expect(sqlOf(tx.$queryRaw)).toBe('SELECT "id" FROM "devices" WHERE "id" = ? FOR UPDATE');
      expect((tx.$queryRaw.mock.calls[0] as unknown[])[1]).toBe('d-1');
      expect(tx.device.findUnique).toHaveBeenCalledWith({
        where: { id: 'd-1' },
        select: UNIT_SELECT,
      });
      expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        tx.device.findUnique.mock.invocationCallOrder[0],
      );
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('loss cases', () => {
    it('hasOpenLossCase: counts reported, searching and confirmed cases of the unit', async () => {
      tx.lossCase.count.mockResolvedValue(1);
      await expect(repository.hasOpenLossCase('d-1', tx as never)).resolves.toBe(true);
      expect(tx.lossCase.count).toHaveBeenCalledWith({
        where: { deviceId: 'd-1', state: { in: OPEN_STATES } },
      });
    });

    it('hasOpenLossCase: false when no case is open', async () => {
      await expect(repository.hasOpenLossCase('d-1', tx as never)).resolves.toBe(false);
    });

    it('openLossCases: the open cases of the units, newest report first', async () => {
      const rows = [{ id: 'lc-1' }];
      prisma.lossCase.findMany.mockResolvedValue(rows);
      await expect(repository.openLossCases(['d-1', 'd-2'])).resolves.toBe(rows);
      expect(prisma.lossCase.findMany).toHaveBeenCalledWith({
        where: { deviceId: { in: ['d-1', 'd-2'] }, state: { in: OPEN_STATES } },
        orderBy: { reportedAt: 'desc' },
        select: { id: true, code: true, state: true, deviceId: true },
      });
      await repository.openLossCases(['d-1'], tx as never);
      expect(tx.lossCase.findMany).toHaveBeenCalledTimes(1);
    });

    it('openLossCases: no read for an empty list', async () => {
      await expect(repository.openLossCases([])).resolves.toEqual([]);
      expect(prisma.lossCase.findMany).not.toHaveBeenCalled();
    });
  });

  describe('returnStates (REQ-EVT-23, D-114)', () => {
    it('reads the units, their resets and their returns, newest first', async () => {
      await expect(repository.returnStates(['d-1'])).resolves.toEqual({
        units: [],
        resets: [],
        returns: [],
      });
      expect(prisma.device.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['d-1'] } },
        select: { id: true, status: true, statusChangedAt: true },
      });
      expect(prisma.deviceReset.findMany).toHaveBeenCalledWith({
        where: { deviceId: { in: ['d-1'] } },
        orderBy: { createdAt: 'desc' },
        select: { deviceId: true, createdAt: true },
      });
      expect(prisma.deviceTransition.findMany).toHaveBeenCalledWith({
        where: { deviceId: { in: ['d-1'] }, toStatus: DeviceStatus.RETURNED },
        orderBy: { createdAt: 'desc' },
        select: { deviceId: true, refType: true, refId: true, createdAt: true },
      });
      expect(prisma.lossCase.findMany).not.toHaveBeenCalled();
    });

    it('adds the contract of the loss case behind a return, null for any other return', async () => {
      tx.deviceTransition.findMany.mockResolvedValue([
        { deviceId: 'd-1', refType: 'LOSS_CASE', refId: 'lc-1', createdAt: AT },
        { deviceId: 'd-2', refType: 'LOSS_CASE', refId: 'lc-1', createdAt: AT },
        { deviceId: 'd-3', refType: 'LOSS_CASE', refId: 'lc-9', createdAt: AT },
        { deviceId: 'd-4', refType: 'CONTRACT', refId: 'c-1', createdAt: EARLIER },
        { deviceId: 'd-5', refType: 'LOSS_CASE', refId: null, createdAt: EARLIER },
      ]);
      tx.lossCase.findMany.mockResolvedValue([{ id: 'lc-1', contractId: 'c-7' }]);
      const { returns } = await repository.returnStates(['d-1'], tx as never);
      expect(tx.lossCase.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['lc-1', 'lc-9'] } },
        select: { id: true, contractId: true },
      });
      expect(returns.map((move) => [move.deviceId, move.lossCaseContractId])).toEqual([
        ['d-1', 'c-7'],
        ['d-2', 'c-7'],
        ['d-3', null],
        ['d-4', null],
        ['d-5', null],
      ]);
      expect(returns[3]).toEqual({
        deviceId: 'd-4',
        refType: 'CONTRACT',
        refId: 'c-1',
        createdAt: EARLIER,
        lossCaseContractId: null,
      });
      expect(prisma.device.findMany).not.toHaveBeenCalled();
    });
  });

  describe('findUnit', () => {
    it('reads one unit with UNIT_SELECT', async () => {
      await repository.findUnit('d-1');
      expect(prisma.device.findUnique).toHaveBeenCalledWith({
        where: { id: 'd-1' },
        select: UNIT_SELECT,
      });
      await repository.findUnit('d-1', tx as never);
      expect(tx.device.findUnique).toHaveBeenCalledTimes(1);
    });
  });

  describe('lastReturnMove (D-114)', () => {
    it('answers null when the unit was never returned', async () => {
      await expect(repository.lastReturnMove('d-1')).resolves.toBeNull();
      expect(prisma.deviceTransition.findFirst).toHaveBeenCalledWith({
        where: { deviceId: 'd-1', toStatus: DeviceStatus.RETURNED },
        orderBy: { createdAt: 'desc' },
        select: { refType: true, refId: true, createdAt: true },
      });
      expect(prisma.lossCase.findUnique).not.toHaveBeenCalled();
    });

    it('answers a check-in without reading a loss case', async () => {
      prisma.deviceTransition.findFirst.mockResolvedValue({
        refType: 'CONTRACT',
        refId: 'c-1',
        createdAt: AT,
      });
      await expect(repository.lastReturnMove('d-1')).resolves.toEqual({
        refType: 'CONTRACT',
        createdAt: AT,
        lossCaseContractId: null,
      });
      expect(prisma.lossCase.findUnique).not.toHaveBeenCalled();
    });

    it('adds the contract of the loss case that made the return, through the given client', async () => {
      tx.deviceTransition.findFirst.mockResolvedValue({
        refType: 'LOSS_CASE',
        refId: 'lc-1',
        createdAt: AT,
      });
      tx.lossCase.findUnique.mockResolvedValue({ contractId: 'c-7' });
      await expect(repository.lastReturnMove('d-1', tx as never)).resolves.toEqual({
        refType: 'LOSS_CASE',
        createdAt: AT,
        lossCaseContractId: 'c-7',
      });
      expect(tx.lossCase.findUnique).toHaveBeenCalledWith({
        where: { id: 'lc-1' },
        select: { contractId: true },
      });
      expect(prisma.deviceTransition.findFirst).not.toHaveBeenCalled();
    });

    it('answers a null contract for a loss case without one, or a case that is gone', async () => {
      prisma.deviceTransition.findFirst.mockResolvedValue({
        refType: 'LOSS_CASE',
        refId: 'lc-1',
        createdAt: AT,
      });
      prisma.lossCase.findUnique.mockResolvedValueOnce({ contractId: null });
      await expect(repository.lastReturnMove('d-1')).resolves.toMatchObject({
        lossCaseContractId: null,
      });
      await expect(repository.lastReturnMove('d-1')).resolves.toMatchObject({
        lossCaseContractId: null,
      });
    });
  });

  describe('resets and returns', () => {
    it('lastResetAt: the newest reset time, null when never reset', async () => {
      await expect(repository.lastResetAt('d-1')).resolves.toBeNull();
      expect(prisma.deviceReset.findFirst).toHaveBeenCalledWith({
        where: { deviceId: 'd-1' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      tx.deviceReset.findFirst.mockResolvedValue({ createdAt: AT });
      await expect(repository.lastResetAt('d-1', tx as never)).resolves.toBe(AT);
    });

    it('resetsOf: every reset of the units, oldest first, on the default client', async () => {
      const rows = [{ deviceId: 'd-1', createdAt: AT }];
      prisma.deviceReset.findMany.mockResolvedValue(rows);
      await expect(repository.resetsOf(['d-1', 'd-2'])).resolves.toBe(rows);
      expect(prisma.deviceReset.findMany).toHaveBeenCalledWith({
        where: { deviceId: { in: ['d-1', 'd-2'] } },
        orderBy: { createdAt: 'asc' },
        select: { deviceId: true, createdAt: true },
      });
    });

    it('returnsOf: every move into RETURNED, oldest first, on the default client', async () => {
      await repository.returnsOf(['d-1']);
      expect(prisma.deviceTransition.findMany).toHaveBeenCalledWith({
        where: { deviceId: { in: ['d-1'] }, toStatus: DeviceStatus.RETURNED },
        orderBy: { createdAt: 'asc' },
        select: { deviceId: true, createdAt: true },
      });
    });
  });

  describe('inspections (billing design section 9.1)', () => {
    it('inspectionById: one inspection with its contract row and result', async () => {
      await repository.inspectionById('in-1');
      expect(prisma.inspection.findUnique).toHaveBeenCalledWith({
        where: { id: 'in-1' },
        select: { id: true, deviceId: true, contractDeviceId: true, result: true, createdAt: true },
      });
      await repository.inspectionById('in-1', tx as never);
      expect(tx.inspection.findUnique).toHaveBeenCalledTimes(1);
    });

    it('inspectionsOfContractDevices: the inspections of the contract rows, oldest first', async () => {
      await repository.inspectionsOfContractDevices(['cd-1', 'cd-2']);
      expect(prisma.inspection.findMany).toHaveBeenCalledWith({
        where: { contractDeviceId: { in: ['cd-1', 'cd-2'] } },
        orderBy: { createdAt: 'asc' },
        select: { id: true, contractDeviceId: true, result: true, createdAt: true },
      });
    });
  });

  describe('insertReset (D-021)', () => {
    it('records the three steps, then clears the key and bumps the version', async () => {
      const unit = { id: 'd-1', keyVersion: null };
      tx.device.update.mockResolvedValue(unit);
      const steps = { keyRemoved: true, nodeDbCleared: true, ownerCleared: false };
      await expect(repository.insertReset('d-1', steps, 'u-1', AT, tx as never)).resolves.toBe(
        unit,
      );
      expect(tx.deviceReset.create).toHaveBeenCalledWith({
        data: { deviceId: 'd-1', ...steps, resetById: 'u-1', createdAt: AT },
      });
      expect(tx.device.update).toHaveBeenCalledWith({
        where: { id: 'd-1' },
        data: { keyVersion: null, keyOrganizationId: null, version: { increment: 1 } },
        select: UNIT_SELECT,
      });
      expect(tx.deviceReset.create.mock.invocationCallOrder[0]).toBeLessThan(
        tx.device.update.mock.invocationCallOrder[0],
      );
      expect(prisma.deviceReset.create).not.toHaveBeenCalled();
    });
  });

  describe('insertDisposal (devices api-design 23, BR-42)', () => {
    it('records the verified wipe and the method, and leaves the device row alone', async () => {
      const steps = { keyRemoved: true, nodeDbCleared: true, ownerCleared: true, method: 'FLASH' };
      await expect(
        repository.insertDisposal('d-1', steps, 'u-2', AT, tx as never),
      ).resolves.toBeUndefined();
      expect(tx.deviceDisposal.create).toHaveBeenCalledWith({
        data: { deviceId: 'd-1', ...steps, verifiedById: 'u-2', disposedAt: AT },
      });
      expect(tx.device.update).not.toHaveBeenCalled();
      expect(prisma.deviceDisposal.create).not.toHaveBeenCalled();
    });
  });
});
