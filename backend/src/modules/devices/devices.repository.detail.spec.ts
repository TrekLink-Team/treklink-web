import { DeviceStatus, InspectionResult } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  DETAIL_SELECT,
  DEVICE_SORT_FIELDS,
  DeviceSortField,
  DevicesRepository,
  LIST_SELECT,
  VARIANT_SUMMARY_SELECT,
} from './devices.repository';

// devices api-design 07, 08 and 30, design sections 2 and 12, task 3.1: the device detail, the
// compare-and-set moves, the firmware and service writes, the intake, transition and inspection rows,
// the lifecycle reads of DevicesRepository from `findDetail` to the end of the class, and the sort
// columns of the fleet list (W26). This file asserts the where clauses, the `version` guard and bump,
// the ordering, the client each call goes through and the rows returned.

const AT = new Date('2026-11-20T03:00:00.000Z');
const BY_TIME = [{ createdAt: 'asc' }, { id: 'asc' }];

const aClient = () => ({
  $transaction: jest.fn((calls: Promise<unknown>[]) => Promise.all(calls)),
  device: {
    findUnique: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue({ id: 'd-1' }),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    count: jest.fn().mockResolvedValue(0),
  },
  intakeCheck: {
    findFirst: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({ id: 'ic-1' }),
  },
  deviceReset: {
    findFirst: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
  },
  deviceTransition: {
    create: jest.fn().mockResolvedValue({ id: 'dt-1' }),
    findMany: jest.fn().mockResolvedValue([]),
  },
  deviceProvisioning: { findMany: jest.fn().mockResolvedValue([]) },
  inspection: {
    findMany: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({ id: 'in-1' }),
  },
  deviceHubAction: { findMany: jest.fn().mockResolvedValue([]) },
});

describe('DevicesRepository detail, conditional moves, firmware, intake and inspection', () => {
  let prisma: ReturnType<typeof aClient>;
  let tx: ReturnType<typeof aClient>;
  let repository: DevicesRepository;

  beforeEach(() => {
    prisma = aClient();
    tx = aClient();
    repository = new DevicesRepository(prisma as unknown as PrismaService);
  });

  describe('findDetail (devices api-design 07)', () => {
    it('reads one device with DETAIL_SELECT, through the default client', async () => {
      const row = { id: 'd-1' };
      prisma.device.findUnique.mockResolvedValue(row);
      await expect(repository.findDetail('d-1')).resolves.toBe(row);
      expect(prisma.device.findUnique).toHaveBeenCalledWith({
        where: { id: 'd-1' },
        select: DETAIL_SELECT,
      });
    });

    it('reads through the transaction client when one is given', async () => {
      await expect(repository.findDetail('d-404', tx as never)).resolves.toBeNull();
      expect(tx.device.findUnique).toHaveBeenCalledTimes(1);
      expect(prisma.device.findUnique).not.toHaveBeenCalled();
    });

    it('selects the fleet row plus the service interval of the variant', () => {
      expect(DETAIL_SELECT).toEqual({
        ...LIST_SELECT,
        hardwareVariant: { select: { ...VARIANT_SUMMARY_SELECT, serviceIntervalDays: true } },
      });
      expect(LIST_SELECT.version).toBe(true);
    });
  });

  describe('byNodeNums (devices api-design 30)', () => {
    it('reads the units with these node numbers, on a copy of the list', async () => {
      const nodeNums = [1n, 2n] as const;
      const rows = [{ id: 'd-1' }];
      prisma.device.findMany.mockResolvedValue(rows);
      await expect(repository.byNodeNums(nodeNums)).resolves.toBe(rows);
      const [args] = prisma.device.findMany.mock.calls[0] as [
        { where: { nodeNum: { in: bigint[] } } },
      ];
      expect(args).toEqual({ where: { nodeNum: { in: [1n, 2n] } }, select: DETAIL_SELECT });
      expect(args.where.nodeNum.in).not.toBe(nodeNums);
      await repository.byNodeNums([3n], tx as never);
      expect(tx.device.findMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('latest intake check and reset', () => {
    it('lastIntakeCheck: the newest check of the unit', async () => {
      const row = { id: 'ic-1', passed: true, createdAt: AT };
      prisma.intakeCheck.findFirst.mockResolvedValue(row);
      await expect(repository.lastIntakeCheck('d-1')).resolves.toBe(row);
      expect(prisma.intakeCheck.findFirst).toHaveBeenCalledWith({
        where: { deviceId: 'd-1' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, passed: true, createdAt: true },
      });
      await repository.lastIntakeCheck('d-1', tx as never);
      expect(tx.intakeCheck.findFirst).toHaveBeenCalledTimes(1);
    });

    it('lastReset: the newest reset of the unit', async () => {
      await expect(repository.lastReset('d-1')).resolves.toBeNull();
      expect(prisma.deviceReset.findFirst).toHaveBeenCalledWith({
        where: { deviceId: 'd-1' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, createdAt: true },
      });
      await repository.lastReset('d-1', tx as never);
      expect(tx.deviceReset.findFirst).toHaveBeenCalledTimes(1);
    });
  });

  describe('moveIfCurrent', () => {
    it('moves the unit only at the loaded version and in one of `from`, and bumps the version', async () => {
      const from = [DeviceStatus.AVAILABLE, DeviceStatus.MAINTENANCE] as const;
      await expect(
        repository.moveIfCurrent('d-1', 4, from, DeviceStatus.RETIRED, AT, tx as never),
      ).resolves.toBe(true);
      const [args] = tx.device.updateMany.mock.calls[0] as [
        { where: { status: { in: DeviceStatus[] } } },
      ];
      expect(args).toEqual({
        where: { id: 'd-1', version: 4, status: { in: ['AVAILABLE', 'MAINTENANCE'] } },
        data: { status: DeviceStatus.RETIRED, statusChangedAt: AT, version: { increment: 1 } },
      });
      expect(args.where.status.in).not.toBe(from);
      expect(prisma.device.updateMany).not.toHaveBeenCalled();
    });

    it('writes the extra fields, but never over the status, time or version', async () => {
      await repository.moveIfCurrent(
        'd-1',
        4,
        [DeviceStatus.MAINTENANCE],
        DeviceStatus.AVAILABLE,
        AT,
        tx as never,
        { serviceDueAt: AT, status: DeviceStatus.LOST, version: 99 },
      );
      expect(tx.device.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            serviceDueAt: AT,
            status: DeviceStatus.AVAILABLE,
            statusChangedAt: AT,
            version: { increment: 1 },
          },
        }),
      );
    });

    it('reports false when another write moved the unit first', async () => {
      tx.device.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        repository.moveIfCurrent(
          'd-1',
          4,
          [DeviceStatus.AVAILABLE],
          DeviceStatus.RETIRED,
          AT,
          tx as never,
        ),
      ).resolves.toBe(false);
    });
  });

  describe('setFirmwareIfCurrent (devices api-design 08)', () => {
    it('writes the firmware only at the loaded version and bumps it', async () => {
      await expect(repository.setFirmwareIfCurrent('d-1', 2, '2.6.0', tx as never)).resolves.toBe(
        true,
      );
      expect(tx.device.updateMany).toHaveBeenCalledWith({
        where: { id: 'd-1', version: 2 },
        data: { firmwareVersion: '2.6.0', version: { increment: 1 } },
      });
      expect(prisma.device.updateMany).not.toHaveBeenCalled();
    });

    it('reports false when the version moved on', async () => {
      tx.device.updateMany.mockResolvedValue({ count: 0 });
      await expect(repository.setFirmwareIfCurrent('d-1', 2, '2.6.0', tx as never)).resolves.toBe(
        false,
      );
    });
  });

  describe('updateService (FR-DEV-17, FR-DEV-21)', () => {
    it('writes the firmware and the service date with a version bump', async () => {
      await expect(
        repository.updateService(
          'd-1',
          { firmwareVersion: '2.6.0', serviceDueAt: AT },
          tx as never,
        ),
      ).resolves.toBeUndefined();
      expect(tx.device.update).toHaveBeenCalledWith({
        where: { id: 'd-1' },
        data: { firmwareVersion: '2.6.0', serviceDueAt: AT, version: { increment: 1 } },
      });
    });

    it('writes one field alone when only one is given', async () => {
      await repository.updateService('d-1', { serviceDueAt: AT }, tx as never);
      expect(tx.device.update).toHaveBeenCalledWith({
        where: { id: 'd-1' },
        data: { serviceDueAt: AT, version: { increment: 1 } },
      });
    });

    it('writes nothing, and keeps the version, when neither is given', async () => {
      await repository.updateService('d-1', {}, tx as never);
      expect(tx.device.update).not.toHaveBeenCalled();
    });
  });

  describe('insertIntakeCheck', () => {
    it('creates the check through the transaction and answers its id, result and time', async () => {
      const data = {
        deviceId: 'd-1',
        gpsFixOk: true,
        radioOk: true,
        batteryOk: false,
        motionOk: null,
        passed: false,
        note: 'battery low',
        checkedById: 'u-1',
        createdAt: AT,
      };
      const created = { id: 'ic-1', passed: false, createdAt: AT };
      tx.intakeCheck.create.mockResolvedValue(created);
      await expect(repository.insertIntakeCheck(data, tx as never)).resolves.toBe(created);
      expect(tx.intakeCheck.create).toHaveBeenCalledWith({
        data,
        select: { id: true, passed: true, createdAt: true },
      });
      expect(prisma.intakeCheck.create).not.toHaveBeenCalled();
    });
  });

  describe('insertTransition (design section 2)', () => {
    it('writes the row as given through the transaction, a null actor for SYSTEM', async () => {
      const data = {
        deviceId: 'd-1',
        fromStatus: null,
        toStatus: DeviceStatus.IN_INTAKE,
        actorId: null,
        reason: 'REGISTERED',
        note: 'retire reason',
        refType: 'INTAKE',
        refId: 'ic-1',
        createdAt: AT,
      };
      await expect(repository.insertTransition(data, tx as never)).resolves.toBeUndefined();
      expect(tx.deviceTransition.create).toHaveBeenCalledWith({ data });
      expect(prisma.deviceTransition.create).not.toHaveBeenCalled();
    });
  });

  describe('lifecycle (monitoring api-design 07)', () => {
    it('reads the six lists of the device, oldest first with the id as tiebreaker', async () => {
      const transitions = [{ id: 'dt-1' }];
      const hubActions = [{ id: 'ha-1' }];
      prisma.deviceTransition.findMany.mockResolvedValue(transitions);
      prisma.deviceHubAction.findMany.mockResolvedValue(hubActions);
      await expect(repository.lifecycle('d-1')).resolves.toEqual({
        transitions,
        intakeChecks: [],
        provisionings: [],
        resets: [],
        inspections: [],
        hubActions,
      });
      expect(prisma.deviceTransition.findMany).toHaveBeenCalledWith({
        where: { deviceId: 'd-1' },
        orderBy: BY_TIME,
        select: {
          id: true,
          fromStatus: true,
          toStatus: true,
          actorId: true,
          reason: true,
          note: true,
          refType: true,
          refId: true,
          createdAt: true,
        },
      });
      expect(prisma.intakeCheck.findMany).toHaveBeenCalledWith({
        where: { deviceId: 'd-1' },
        orderBy: BY_TIME,
        select: { id: true, passed: true, checkedById: true, createdAt: true },
      });
      expect(prisma.deviceProvisioning.findMany).toHaveBeenCalledWith({
        where: { deviceId: 'd-1' },
        orderBy: BY_TIME,
        select: {
          id: true,
          organizationId: true,
          keyVersion: true,
          provisionedById: true,
          createdAt: true,
        },
      });
      expect(prisma.deviceReset.findMany).toHaveBeenCalledWith({
        where: { deviceId: 'd-1' },
        orderBy: BY_TIME,
        select: { id: true, resetById: true, createdAt: true },
      });
      expect(prisma.inspection.findMany).toHaveBeenCalledWith({
        where: { deviceId: 'd-1' },
        orderBy: BY_TIME,
        select: { id: true, result: true, damageCodes: true, inspectorId: true, createdAt: true },
      });
    });

    it('orders the hub actions by their start time, then id', async () => {
      await repository.lifecycle('d-1');
      expect(prisma.deviceHubAction.findMany).toHaveBeenCalledWith({
        where: { deviceId: 'd-1' },
        orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          action: true,
          outcome: true,
          firmwareTo: true,
          failure: true,
          actorId: true,
          startedAt: true,
          finishedAt: true,
        },
      });
    });

    it('reads every list through the transaction client when one is given', async () => {
      await repository.lifecycle('d-1', tx as never);
      for (const delegate of [
        tx.deviceTransition,
        tx.intakeCheck,
        tx.deviceProvisioning,
        tx.deviceReset,
        tx.inspection,
        tx.deviceHubAction,
      ]) {
        expect(delegate.findMany).toHaveBeenCalledTimes(1);
      }
      expect(prisma.deviceTransition.findMany).not.toHaveBeenCalled();
      expect(prisma.deviceHubAction.findMany).not.toHaveBeenCalled();
    });
  });

  describe('insertInspection', () => {
    it('creates the inspection through the transaction and answers the recorded fields', async () => {
      const data = {
        deviceId: 'd-1',
        contractDeviceId: 'cd-1',
        result: InspectionResult.DAMAGED,
        damageCodes: ['SCREEN'],
        note: null,
        inspectorId: 'u-1',
        createdAt: AT,
      };
      const created = { id: 'in-1', result: data.result, damageCodes: ['SCREEN'], createdAt: AT };
      tx.inspection.create.mockResolvedValue(created);
      await expect(repository.insertInspection(data, tx as never)).resolves.toBe(created);
      expect(tx.inspection.create).toHaveBeenCalledWith({
        data,
        select: { id: true, result: true, damageCodes: true, createdAt: true },
      });
      expect(prisma.inspection.create).not.toHaveBeenCalled();
    });
  });

  describe('fleet sort columns (devices api-design 06, W26)', () => {
    it('allows six fields and no other', () => {
      expect(DEVICE_SORT_FIELDS).toEqual([
        'assetTag',
        'nodeId',
        'status',
        'batteryPct',
        'lastSeenAt',
        'serviceDueAt',
      ]);
    });

    const orderOf = async (field: DeviceSortField, order: 'asc' | 'desc') => {
      prisma.device.findMany.mockClear();
      await repository.page({}, 0, 20, { field, order });
      return (prisma.device.findMany.mock.calls[0] as [{ orderBy: unknown }])[0].orderBy;
    };

    it.each([
      ['assetTag', { assetTag: 'desc' }],
      ['nodeId', { nodeNum: 'desc' }],
      ['status', { status: 'desc' }],
    ] as const)('%s sorts on its own column, then the id', async (field, column) => {
      await expect(orderOf(field, 'desc')).resolves.toEqual([column, { id: 'desc' }]);
    });

    it.each([
      ['batteryPct', 'batteryPct'],
      ['lastSeenAt', 'lastSeenAt'],
      ['serviceDueAt', 'serviceDueAt'],
    ] as const)('%s puts a missing value last in either direction', async (field, column) => {
      await expect(orderOf(field, 'asc')).resolves.toEqual([
        { [column]: { sort: 'asc', nulls: 'last' } },
        { id: 'asc' },
      ]);
      await expect(orderOf(field, 'desc')).resolves.toEqual([
        { [column]: { sort: 'desc', nulls: 'last' } },
        { id: 'desc' },
      ]);
    });
  });
});
