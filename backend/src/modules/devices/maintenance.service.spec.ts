import { DeviceStatus, MaintenanceStatus, Prisma } from '@prisma/client';
import { DomainException, ErrorCode } from '../../common/errors';
import { DevicesRepository } from './devices.repository';
import { MaintenanceRepository } from './maintenance.repository';
import { MaintenanceService } from './maintenance.service';

const AT = new Date('2026-11-02T03:00:00.000Z');
const TX = {} as Prisma.TransactionClient;
const THRESHOLD = 1_000_000;
const LEAD_DAYS = 5;

const device = (overrides: Record<string, unknown> = {}) => ({
  id: 'd-9',
  assetTag: 'TL-0009',
  nodeNum: 0xde000009n,
  firmwareVersion: '2.7.19-treklink.3',
  acquiredAt: new Date('2026-01-01T00:00:00Z'),
  status: DeviceStatus.AVAILABLE,
  statusChangedAt: AT,
  keyVersion: null,
  keyOrganizationId: null,
  batteryPct: 90,
  lastSeenAt: null,
  lastLatitude: null,
  lastLongitude: null,
  serviceDueAt: null,
  version: 3,
  hardwareVariant: {
    id: 'v-3',
    code: 'treklink-v3',
    hasMotionSensor: false,
    firmwareBaseline: '2.7.19-treklink.3',
    serviceIntervalDays: 180,
  },
  ...overrides,
});

const record = (overrides: Record<string, unknown> = {}) => ({
  id: 'm-1',
  deviceId: 'd-9',
  reason: 'STAFF_REPORTED',
  status: MaintenanceStatus.OPEN,
  description: 'Antenna loose',
  expectedAt: new Date('2026-11-05T00:00:00Z'),
  workBy: null,
  vendorName: null,
  estimatedCostVnd: null,
  estimatedById: null,
  approvedCostVnd: null,
  decision: null,
  decisionReason: null,
  actualCostVnd: null,
  warrantyUntil: null,
  checklistResults: null,
  firmwareVersion: null,
  resolution: null,
  openedAt: AT,
  closedAt: null,
  version: 0,
  device: {
    id: 'd-9',
    assetTag: 'TL-0009',
    hardwareVariant: { serviceChecklist: ['Battery health', 'Antenna'], serviceIntervalDays: 180 },
  },
  ...overrides,
});

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(DomainException);
    return ((error as DomainException).getResponse() as { errorCode: string }).errorCode;
  }
  throw new Error('expected a DomainException');
};

describe('MaintenanceService (devices task 2.8, api-design 11 to 15)', () => {
  let records: Record<string, jest.Mock>;
  let devices: Record<string, jest.Mock>;
  let parameters: { get: jest.Mock };
  let service: MaintenanceService;

  beforeEach(() => {
    records = {
      findOpen: jest.fn().mockResolvedValue(null),
      create: jest
        .fn()
        .mockImplementation((data: Record<string, unknown>) =>
          Promise.resolve(record({ ...data, id: 'm-new' })),
        ),
      find: jest.fn().mockResolvedValue(record()),
      updateIfCurrent: jest.fn().mockResolvedValue(true),
      page: jest.fn().mockResolvedValue([[record()], 1]),
      ofDevice: jest.fn().mockResolvedValue([record()]),
    };
    devices = {
      findDetail: jest.fn().mockResolvedValue(device()),
      moveIfCurrent: jest.fn().mockResolvedValue(true),
      insertTransition: jest.fn().mockResolvedValue(undefined),
      updateService: jest.fn().mockResolvedValue(undefined),
    };
    parameters = {
      get: jest.fn((key: string) =>
        Promise.resolve(key === 'devices.maintenanceLeadDays' ? LEAD_DAYS : THRESHOLD),
      ),
    };
    service = new MaintenanceService(
      records as unknown as MaintenanceRepository,
      devices as unknown as DevicesRepository,
      parameters as never,
    );
  });

  describe('dueReason (REQ-EVT-07)', () => {
    const facts = (serviceDueAt: Date | null, firmwareVersion = 'a') => ({
      serviceDueAt,
      firmwareVersion,
      firmwareBaseline: 'a',
    });

    it('is SCHEDULED when the service falls due within the lead days', async () => {
      await expect(service.dueReason(facts(new Date('2026-11-07T00:00:00Z')), AT)).resolves.toBe(
        'SCHEDULED',
      );
    });

    it('is FIRMWARE_UPDATE when only the firmware is off the baseline', async () => {
      await expect(
        service.dueReason(facts(new Date('2026-12-30T00:00:00Z'), 'b'), AT),
      ).resolves.toBe('FIRMWARE_UPDATE');
      await expect(service.dueReason(facts(null, 'b'), AT)).resolves.toBe('FIRMWARE_UPDATE');
    });

    it('is null for a unit neither due nor off the baseline', async () => {
      await expect(service.dueReason(facts(new Date('2026-12-30T00:00:00Z')), AT)).resolves.toBe(
        null,
      );
      await expect(service.dueReason(facts(null), AT)).resolves.toBeNull();
    });
  });

  it('opens a system record with SYSTEM as the actor when none is given', async () => {
    await service.openForSystem(
      { deviceId: 'd-9', reason: 'INTAKE_FAILED', description: 'x', expectedAt: AT },
      null,
      AT,
      TX,
    );
    expect(records.create).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'INTAKE_FAILED',
        status: MaintenanceStatus.OPEN,
        openedById: null,
        estimatedCostVnd: null,
      }),
      TX,
    );
  });

  describe('open (api-design 11)', () => {
    const dto = {
      reason: 'STAFF_REPORTED' as const,
      description: '  Antenna loose  ',
      expectedAt: '2026-11-05',
      expectedVersion: 3,
    };

    it('moves an AVAILABLE unit to MAINTENANCE with an OPEN record and a transition', async () => {
      const result = await service.open('d-9', dto, 'staff-1', AT, TX);
      expect(devices.moveIfCurrent).toHaveBeenCalledWith(
        'd-9',
        3,
        [DeviceStatus.AVAILABLE],
        DeviceStatus.MAINTENANCE,
        AT,
        TX,
      );
      expect(records.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: MaintenanceStatus.OPEN,
          description: 'Antenna loose',
          expectedAt: new Date('2026-11-05T00:00:00.000Z'),
          estimatedById: null,
          openedById: 'staff-1',
        }),
        TX,
      );
      expect(devices.insertTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'MAINTENANCE_OPENED',
          refType: 'MAINTENANCE',
          refId: 'm-new',
        }),
        TX,
      );
      expect(result.record.id).toBe('m-new');
      expect(result.device.assetTag).toBe('TL-0009');
    });

    it('leaves an estimate above the threshold PENDING_APPROVAL, by the estimator', async () => {
      await service.open(
        'd-9',
        { ...dto, workBy: 'VENDOR', vendorName: ' Fixit ', estimatedCostVnd: THRESHOLD + 1 },
        'staff-1',
        AT,
        TX,
      );
      expect(records.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: MaintenanceStatus.PENDING_APPROVAL,
          vendorName: 'Fixit',
          estimatedCostVnd: BigInt(THRESHOLD + 1),
          estimatedById: 'staff-1',
        }),
        TX,
      );
    });

    it('falls back to the device read before the move when the reread finds nothing', async () => {
      devices.findDetail.mockResolvedValueOnce(device()).mockResolvedValueOnce(null);
      const result = await service.open('d-9', dto, 'staff-1', AT, TX);
      expect(result.device.status).toBe(DeviceStatus.AVAILABLE);
    });

    it('refuses an unknown device, an open record, a wrong state and a stale version', async () => {
      devices.findDetail.mockResolvedValueOnce(null);
      expect(await codeOf(service.open('d-9', dto, 's', AT, TX))).toBe(ErrorCode.NOT_FOUND);

      records.findOpen.mockResolvedValueOnce(record());
      expect(await codeOf(service.open('d-9', dto, 's', AT, TX))).toBe(ErrorCode.MAINTENANCE_OPEN);

      devices.findDetail.mockResolvedValueOnce(device({ status: DeviceStatus.RENTED }));
      expect(await codeOf(service.open('d-9', dto, 's', AT, TX))).toBe(
        ErrorCode.INVALID_STATE_TRANSITION,
      );

      expect(await codeOf(service.open('d-9', { ...dto, expectedVersion: 2 }, 's', AT, TX))).toBe(
        ErrorCode.STALE_VERSION,
      );

      devices.moveIfCurrent.mockResolvedValueOnce(false);
      expect(await codeOf(service.open('d-9', dto, 's', AT, TX))).toBe(ErrorCode.STALE_VERSION);
    });

    it('needs a vendor name for vendor work (REQ-ERR-10)', async () => {
      expect(await codeOf(service.open('d-9', { ...dto, workBy: 'VENDOR' }, 's', AT, TX))).toBe(
        ErrorCode.VENDOR_REQUIRED,
      );
    });

    it('maps a unique violation of the one-open-record rule to MAINTENANCE_OPEN', async () => {
      records.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: '6' }),
      );
      expect(await codeOf(service.open('d-9', dto, 's', AT, TX))).toBe(ErrorCode.MAINTENANCE_OPEN);
      const boom = new Error('db down');
      records.create.mockRejectedValueOnce(boom);
      await expect(service.open('d-9', dto, 's', AT, TX)).rejects.toBe(boom);
    });
  });

  describe('estimate (api-design 12)', () => {
    it('records in-house work below the threshold and stays OPEN', async () => {
      await service.estimate(
        'd-9',
        'm-1',
        {
          workBy: 'IN_HOUSE',
          vendorName: 'ignored',
          estimatedCostVnd: 200_000,
          expectedVersion: 0,
        },
        'staff-1',
        TX,
      );
      expect(records.updateIfCurrent).toHaveBeenCalledWith(
        'm-1',
        0,
        [MaintenanceStatus.OPEN],
        expect.objectContaining({
          status: MaintenanceStatus.OPEN,
          vendorName: null,
          estimatedCostVnd: 200_000n,
          estimatedById: 'staff-1',
          approvedCostVnd: null,
        }),
        TX,
      );
    });

    it('sends vendor work above the threshold to PENDING_APPROVAL', async () => {
      await service.estimate(
        'd-9',
        'm-1',
        {
          workBy: 'VENDOR',
          vendorName: ' Fixit ',
          estimatedCostVnd: 2_000_000,
          expectedVersion: 0,
        },
        'staff-1',
        TX,
      );
      expect(records.updateIfCurrent).toHaveBeenCalledWith(
        'm-1',
        0,
        [MaintenanceStatus.OPEN],
        expect.objectContaining({
          status: MaintenanceStatus.PENDING_APPROVAL,
          vendorName: 'Fixit',
        }),
        TX,
      );
    });

    it('refuses another device, a record not OPEN, a stale version and a lost race', async () => {
      const dto = { workBy: 'IN_HOUSE' as const, estimatedCostVnd: 1, expectedVersion: 0 };
      records.find.mockResolvedValueOnce(record({ deviceId: 'd-other' }));
      expect(await codeOf(service.estimate('d-9', 'm-1', dto, 's', TX))).toBe(ErrorCode.NOT_FOUND);
      records.find.mockResolvedValueOnce(null);
      expect(await codeOf(service.estimate('d-9', 'm-1', dto, 's', TX))).toBe(ErrorCode.NOT_FOUND);
      records.find.mockResolvedValueOnce(record({ status: MaintenanceStatus.COMPLETED }));
      expect(await codeOf(service.estimate('d-9', 'm-1', dto, 's', TX))).toBe(
        ErrorCode.INVALID_STATE_TRANSITION,
      );
      expect(
        await codeOf(service.estimate('d-9', 'm-1', { ...dto, expectedVersion: 7 }, 's', TX)),
      ).toBe(ErrorCode.STALE_VERSION);
      records.updateIfCurrent.mockResolvedValueOnce(false);
      expect(await codeOf(service.estimate('d-9', 'm-1', dto, 's', TX))).toBe(
        ErrorCode.STALE_VERSION,
      );
    });

    it('answers 404 when the record vanishes before the answer is read', async () => {
      records.find.mockResolvedValueOnce(record()).mockResolvedValueOnce(null);
      const dto = { workBy: 'IN_HOUSE' as const, estimatedCostVnd: 1, expectedVersion: 0 };
      expect(await codeOf(service.estimate('d-9', 'm-1', dto, 's', TX))).toBe(ErrorCode.NOT_FOUND);
    });
  });

  describe('decide (api-design 13, BR-44)', () => {
    const pending = record({
      status: MaintenanceStatus.PENDING_APPROVAL,
      estimatedById: 'staff-1',
      estimatedCostVnd: 2_000_000n,
      version: 1,
    });

    beforeEach(() => records.find.mockResolvedValue(pending));

    it('approves an amount and returns the record to OPEN', async () => {
      await service.decide(
        'd-9',
        'm-1',
        { decision: 'APPROVED', approvedCostVnd: 1_800_000, expectedVersion: 1 },
        'admin-1',
        AT,
        TX,
      );
      expect(records.updateIfCurrent).toHaveBeenCalledWith(
        'm-1',
        1,
        [MaintenanceStatus.PENDING_APPROVAL],
        expect.objectContaining({
          status: MaintenanceStatus.OPEN,
          decision: 'APPROVED',
          approvedCostVnd: 1_800_000n,
          decisionReason: null,
          decidedById: 'admin-1',
          decidedAt: AT,
        }),
        TX,
      );
    });

    it('rejects with a reason', async () => {
      await service.decide(
        'd-9',
        'm-1',
        { decision: 'REJECTED', reason: ' Too dear ', expectedVersion: 1 },
        'admin-1',
        AT,
        TX,
      );
      expect(records.updateIfCurrent).toHaveBeenCalledWith(
        'm-1',
        1,
        [MaintenanceStatus.PENDING_APPROVAL],
        expect.objectContaining({ approvedCostVnd: null, decisionReason: 'Too dear' }),
        TX,
      );
    });

    it('refuses the estimator, a record not pending, a stale version and missing fields', async () => {
      const approve = { decision: 'APPROVED' as const, approvedCostVnd: 1, expectedVersion: 1 };
      expect(await codeOf(service.decide('d-9', 'm-1', approve, 'staff-1', AT, TX))).toBe(
        ErrorCode.SEPARATION_OF_DUTY,
      );
      records.find.mockResolvedValueOnce(record());
      expect(await codeOf(service.decide('d-9', 'm-1', approve, 'admin-1', AT, TX))).toBe(
        ErrorCode.INVALID_STATE_TRANSITION,
      );
      expect(
        await codeOf(
          service.decide('d-9', 'm-1', { ...approve, expectedVersion: 0 }, 'admin-1', AT, TX),
        ),
      ).toBe(ErrorCode.STALE_VERSION);
      expect(
        await codeOf(
          service.decide(
            'd-9',
            'm-1',
            { decision: 'APPROVED', expectedVersion: 1 },
            'admin-1',
            AT,
            TX,
          ),
        ),
      ).toBe(ErrorCode.VALIDATION_FAILED);
      expect(
        await codeOf(
          service.decide(
            'd-9',
            'm-1',
            { decision: 'REJECTED', reason: '  ', expectedVersion: 1 },
            'admin-1',
            AT,
            TX,
          ),
        ),
      ).toBe(ErrorCode.VALIDATION_FAILED);
    });
  });

  describe('complete (api-design 14)', () => {
    const base = { resolution: ' Replaced antenna ', expectedVersion: 0 };

    it('closes a record UNREPAIRABLE with or without a cost', async () => {
      await service.complete(
        'd-9',
        'm-1',
        { ...base, status: 'UNREPAIRABLE', actualCostVnd: 5 },
        'staff-1',
        AT,
        TX,
      );
      expect(records.updateIfCurrent).toHaveBeenLastCalledWith(
        'm-1',
        0,
        [MaintenanceStatus.OPEN],
        expect.objectContaining({
          status: MaintenanceStatus.UNREPAIRABLE,
          resolution: 'Replaced antenna',
          actualCostVnd: 5n,
          closedById: 'staff-1',
        }),
        TX,
      );
      await service.complete('d-9', 'm-1', { ...base, status: 'UNREPAIRABLE' }, 's', AT, TX);
      expect(records.updateIfCurrent).toHaveBeenLastCalledWith(
        'm-1',
        0,
        [MaintenanceStatus.OPEN],
        expect.objectContaining({ actualCostVnd: null }),
        TX,
      );
      expect(devices.updateService).not.toHaveBeenCalled();
    });

    it('completes a staff-reported record and leaves the service date alone', async () => {
      await service.complete(
        'd-9',
        'm-1',
        {
          ...base,
          status: 'COMPLETED',
          actualCostVnd: 300_000,
          warrantyUntil: '2027-01-01',
          checklistResults: [{ item: 'Antenna', passed: true, note: '  ' }],
        },
        'staff-1',
        AT,
        TX,
      );
      expect(records.updateIfCurrent).toHaveBeenCalledWith(
        'm-1',
        0,
        [MaintenanceStatus.OPEN],
        expect.objectContaining({
          status: MaintenanceStatus.COMPLETED,
          actualCostVnd: 300_000n,
          warrantyUntil: new Date('2027-01-01T00:00:00.000Z'),
          checklistResults: [{ item: 'Antenna', passed: true }],
          firmwareVersion: null,
        }),
        TX,
      );
      expect(devices.updateService).toHaveBeenCalledWith('d-9', {}, TX);
    });

    it('moves the service date after a SCHEDULED record with every checklist item (REQ-EVT-18)', async () => {
      records.find.mockResolvedValue(record({ reason: 'SCHEDULED' }));
      await service.complete(
        'd-9',
        'm-1',
        {
          ...base,
          status: 'COMPLETED',
          actualCostVnd: 0,
          checklistResults: [
            { item: 'Battery health', passed: true, note: ' ok ' },
            { item: 'Antenna', passed: false },
          ],
        },
        'staff-1',
        AT,
        TX,
      );
      expect(records.updateIfCurrent).toHaveBeenCalledWith(
        'm-1',
        0,
        [MaintenanceStatus.OPEN],
        expect.objectContaining({
          checklistResults: [
            { item: 'Battery health', passed: true, note: 'ok' },
            { item: 'Antenna', passed: false },
          ],
        }),
        TX,
      );
      expect(devices.updateService).toHaveBeenCalledWith(
        'd-9',
        { serviceDueAt: new Date('2027-05-01T00:00:00.000Z') },
        TX,
      );
    });

    it('does not move the service date for a SCHEDULED record of a variant without an interval', async () => {
      records.find.mockResolvedValue(
        record({
          reason: 'SCHEDULED',
          device: {
            id: 'd-9',
            assetTag: 'TL-0009',
            hardwareVariant: { serviceChecklist: [], serviceIntervalDays: null },
          },
        }),
      );
      await service.complete(
        'd-9',
        'm-1',
        { ...base, status: 'COMPLETED', actualCostVnd: 0 },
        's',
        AT,
        TX,
      );
      expect(devices.updateService).toHaveBeenCalledWith('d-9', {}, TX);
    });

    it('refuses a SCHEDULED record with a missing checklist item (REQ-ERR-09)', async () => {
      records.find.mockResolvedValue(record({ reason: 'SCHEDULED' }));
      expect(
        await codeOf(
          service.complete(
            'd-9',
            'm-1',
            {
              ...base,
              status: 'COMPLETED',
              actualCostVnd: 0,
              checklistResults: [{ item: 'Antenna', passed: true }],
            },
            's',
            AT,
            TX,
          ),
        ),
      ).toBe(ErrorCode.CHECKLIST_INCOMPLETE);
      expect(
        await codeOf(
          service.complete(
            'd-9',
            'm-1',
            { ...base, status: 'COMPLETED', actualCostVnd: 0 },
            's',
            AT,
            TX,
          ),
        ),
      ).toBe(ErrorCode.CHECKLIST_INCOMPLETE);
    });

    it('writes the new firmware of a FIRMWARE_UPDATE record, which needs it (AC-12)', async () => {
      records.find.mockResolvedValue(record({ reason: 'FIRMWARE_UPDATE' }));
      expect(
        await codeOf(
          service.complete(
            'd-9',
            'm-1',
            { ...base, status: 'COMPLETED', actualCostVnd: 0 },
            's',
            AT,
            TX,
          ),
        ),
      ).toBe(ErrorCode.FIRMWARE_VERSION_REQUIRED);
      await service.complete(
        'd-9',
        'm-1',
        { ...base, status: 'COMPLETED', actualCostVnd: 0, firmwareVersion: ' 2.7.20 ' },
        's',
        AT,
        TX,
      );
      expect(devices.updateService).toHaveBeenCalledWith('d-9', { firmwareVersion: '2.7.20' }, TX);
    });

    it('sends a cost above the threshold, or above the approved amount, back to PENDING_APPROVAL', async () => {
      await service.complete(
        'd-9',
        'm-1',
        { ...base, status: 'COMPLETED', actualCostVnd: THRESHOLD + 1 },
        'staff-2',
        AT,
        TX,
      );
      expect(records.updateIfCurrent).toHaveBeenLastCalledWith(
        'm-1',
        0,
        [MaintenanceStatus.OPEN],
        expect.objectContaining({
          status: MaintenanceStatus.PENDING_APPROVAL,
          estimatedById: 'staff-2',
          checklistResults: Prisma.DbNull,
        }),
        TX,
      );
      records.find.mockResolvedValue(record({ approvedCostVnd: 100n }));
      await service.complete(
        'd-9',
        'm-1',
        { ...base, status: 'COMPLETED', actualCostVnd: 101 },
        'staff-2',
        AT,
        TX,
      );
      expect(records.updateIfCurrent).toHaveBeenLastCalledWith(
        'm-1',
        0,
        [MaintenanceStatus.OPEN],
        expect.objectContaining({ status: MaintenanceStatus.PENDING_APPROVAL }),
        TX,
      );
      expect(devices.updateService).not.toHaveBeenCalled();
    });

    it('refuses a record not OPEN, a stale version and a completion without a cost', async () => {
      records.find.mockResolvedValueOnce(record({ status: MaintenanceStatus.PENDING_APPROVAL }));
      expect(
        await codeOf(
          service.complete(
            'd-9',
            'm-1',
            { ...base, status: 'COMPLETED', actualCostVnd: 0 },
            's',
            AT,
            TX,
          ),
        ),
      ).toBe(ErrorCode.INVALID_STATE_TRANSITION);
      expect(
        await codeOf(
          service.complete(
            'd-9',
            'm-1',
            { ...base, expectedVersion: 4, status: 'COMPLETED', actualCostVnd: 0 },
            's',
            AT,
            TX,
          ),
        ),
      ).toBe(ErrorCode.STALE_VERSION);
      expect(
        await codeOf(service.complete('d-9', 'm-1', { ...base, status: 'COMPLETED' }, 's', AT, TX)),
      ).toBe(ErrorCode.VALIDATION_FAILED);
    });
  });

  it('pages records, reads the open record and answers whether one is open', async () => {
    await expect(service.page({}, 0, 20)).resolves.toEqual([
      [expect.objectContaining({ id: 'm-1', expectedAt: '2026-11-05' })],
      1,
    ]);
    await expect(service.openRecordOf('d-9')).resolves.toBeNull();
    await expect(service.hasOpenRecord('d-9', TX)).resolves.toBe(false);
    records.findOpen.mockResolvedValue(record({ estimatedCostVnd: 5n }));
    await expect(service.openRecordOf('d-9')).resolves.toEqual(
      expect.objectContaining({ id: 'm-1', estimatedCostVnd: 5 }),
    );
    await expect(service.hasOpenRecord('d-9')).resolves.toBe(true);
    await expect(service.ofDevice('d-9')).resolves.toHaveLength(1);
  });
});
