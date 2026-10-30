import { DeviceStatus, Prisma } from '@prisma/client';
import { DomainException, ErrorCode } from '../../common/errors';
import { DevicesRepository } from './devices.repository';
import { IntakeService } from './intake.service';
import { MaintenanceService } from './maintenance.service';

const AT = new Date('2026-11-02T03:00:00.000Z');
const TX = {} as Prisma.TransactionClient;

const device = (overrides: Record<string, unknown> = {}, motion = false) => ({
  id: 'd-42',
  assetTag: 'TL-0042',
  nodeNum: 0xa4b1c2d3n,
  firmwareVersion: '2.7.19-treklink.3',
  acquiredAt: new Date('2026-06-15T00:00:00Z'),
  status: DeviceStatus.IN_INTAKE,
  statusChangedAt: AT,
  keyVersion: null,
  keyOrganizationId: null,
  batteryPct: null,
  lastSeenAt: null,
  lastLatitude: null,
  lastLongitude: null,
  serviceDueAt: null,
  version: 0,
  hardwareVariant: {
    id: 'v-3',
    code: 'treklink-v3',
    hasMotionSensor: motion,
    firmwareBaseline: '2.7.19-treklink.3',
    serviceIntervalDays: 180,
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

describe('IntakeService (devices task 2.2)', () => {
  let devices: Record<string, jest.Mock>;
  let maintenance: { hasOpenRecord: jest.Mock; openForSystem: jest.Mock };
  let service: IntakeService;

  beforeEach(() => {
    devices = {
      findDetail: jest.fn().mockResolvedValue(device()),
      insertIntakeCheck: jest
        .fn()
        .mockImplementation((data: { passed: boolean }) =>
          Promise.resolve({ id: 'ic-1', passed: data.passed, createdAt: AT }),
        ),
      moveIfCurrent: jest.fn().mockResolvedValue(true),
      insertTransition: jest.fn().mockResolvedValue(undefined),
      findVariant: jest.fn().mockResolvedValue({ id: 'v-3', isActive: true }),
      findRegistered: jest.fn().mockResolvedValue(null),
      insertDevice: jest.fn().mockResolvedValue(device()),
    };
    maintenance = {
      hasOpenRecord: jest.fn().mockResolvedValue(false),
      openForSystem: jest.fn().mockResolvedValue({ id: 'm-1' }),
    };
    service = new IntakeService(
      devices as unknown as DevicesRepository,
      maintenance as unknown as MaintenanceService,
    );
  });

  describe('record (api-design 09)', () => {
    const pass = { gpsFixOk: true, radioOk: true, batteryOk: true, expectedVersion: 0 };

    it('moves a passed IN_INTAKE unit to AVAILABLE and sets the first service date', async () => {
      const result = await service.record('d-42', { ...pass, note: '  ' }, 'staff-1', AT, TX);
      expect(devices.insertIntakeCheck).toHaveBeenCalledWith(
        expect.objectContaining({ passed: true, motionOk: null, note: null }),
        TX,
      );
      expect(devices.moveIfCurrent).toHaveBeenCalledWith(
        'd-42',
        0,
        [DeviceStatus.IN_INTAKE, DeviceStatus.MAINTENANCE],
        DeviceStatus.AVAILABLE,
        AT,
        TX,
        { serviceDueAt: new Date('2027-05-01T00:00:00.000Z') },
      );
      expect(devices.insertTransition).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'INTAKE_PASSED', refId: 'ic-1' }),
        TX,
      );
      expect(maintenance.openForSystem).not.toHaveBeenCalled();
      expect(result.check.passed).toBe(true);
    });

    it('keeps the service date of a unit that already has one (AC-03)', async () => {
      devices.findDetail.mockResolvedValue(
        device({ status: DeviceStatus.MAINTENANCE, serviceDueAt: new Date('2027-01-01') }),
      );
      await service.record('d-42', pass, 'staff-1', AT, TX);
      expect((devices.moveIfCurrent.mock.calls[0] as unknown[])[6]).toEqual({});
    });

    it('needs the motion result for a motion variant, and fails on a failed motion sensor', async () => {
      devices.findDetail.mockResolvedValue(device({}, true));
      expect(await codeOf(service.record('d-42', pass, 's', AT, TX))).toBe(
        ErrorCode.MOTION_RESULT_REQUIRED,
      );
      await service.record('d-42', { ...pass, motionOk: false, note: ' wobble ' }, 's', AT, TX);
      expect(devices.insertIntakeCheck).toHaveBeenCalledWith(
        expect.objectContaining({ passed: false, motionOk: false, note: 'wobble' }),
        TX,
      );
      expect(maintenance.openForSystem).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'INTAKE_FAILED',
          description: 'Intake check failed: motion sensor.',
        }),
        's',
        AT,
        TX,
      );
    });

    it('ignores a motion result for a variant without the sensor', async () => {
      await service.record('d-42', { ...pass, motionOk: false }, 's', AT, TX);
      expect(devices.insertIntakeCheck).toHaveBeenCalledWith(
        expect.objectContaining({ passed: true, motionOk: null }),
        TX,
      );
    });

    it('moves a failed unit to MAINTENANCE with an INTAKE_FAILED record naming each failure', async () => {
      await service.record(
        'd-42',
        { gpsFixOk: false, radioOk: false, batteryOk: false, expectedVersion: 0 },
        's',
        AT,
        TX,
      );
      expect((devices.moveIfCurrent.mock.calls[0] as unknown[])[3]).toBe(DeviceStatus.MAINTENANCE);
      expect(devices.insertTransition).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'INTAKE_FAILED' }),
        TX,
      );
      expect(
        (maintenance.openForSystem.mock.calls[0] as [{ description: string }])[0].description,
      ).toBe('Intake check failed: GPS fix, radio, battery.');
    });

    it('writes no transition when a failed MAINTENANCE unit stays in MAINTENANCE', async () => {
      devices.findDetail.mockResolvedValue(device({ status: DeviceStatus.MAINTENANCE }));
      await service.record('d-42', { ...pass, batteryOk: false }, 's', AT, TX);
      expect(devices.insertTransition).not.toHaveBeenCalled();
    });

    it('answers with the device read before the move when the reread finds nothing', async () => {
      devices.findDetail.mockResolvedValueOnce(device()).mockResolvedValueOnce(null);
      const result = await service.record('d-42', pass, 's', AT, TX);
      expect(result.device.status).toBe(DeviceStatus.IN_INTAKE);
    });

    it('refuses an unknown device, a wrong state, an open record and a stale version', async () => {
      devices.findDetail.mockResolvedValueOnce(null);
      expect(await codeOf(service.record('d-42', pass, 's', AT, TX))).toBe(ErrorCode.NOT_FOUND);
      devices.findDetail.mockResolvedValueOnce(device({ status: DeviceStatus.RENTED }));
      expect(await codeOf(service.record('d-42', pass, 's', AT, TX))).toBe(
        ErrorCode.INVALID_STATE_TRANSITION,
      );
      maintenance.hasOpenRecord.mockResolvedValueOnce(true);
      expect(await codeOf(service.record('d-42', pass, 's', AT, TX))).toBe(
        ErrorCode.MAINTENANCE_OPEN,
      );
      expect(
        await codeOf(service.record('d-42', { ...pass, expectedVersion: 1 }, 's', AT, TX)),
      ).toBe(ErrorCode.STALE_VERSION);
      devices.moveIfCurrent.mockResolvedValueOnce(false);
      expect(await codeOf(service.record('d-42', pass, 's', AT, TX))).toBe(ErrorCode.STALE_VERSION);
    });
  });

  describe('register (api-design 05)', () => {
    const dto = {
      assetTag: ' TL-0042 ',
      nodeNum: 2763113171 as number | string,
      hardwareVariantId: 'v-3',
      firmwareVersion: ' 2.7.19-treklink.3 ',
      acquiredAt: '2026-06-15',
    };

    it('creates the unit IN_INTAKE with a registration transition', async () => {
      const view = await service.register(dto, 'staff-1', AT, TX);
      expect(devices.insertDevice).toHaveBeenCalledWith(
        {
          assetTag: 'TL-0042',
          nodeNum: 2763113171n,
          hardwareVariantId: 'v-3',
          firmwareVersion: '2.7.19-treklink.3',
          acquiredAt: new Date('2026-06-15T00:00:00.000Z'),
          registeredById: 'staff-1',
          statusChangedAt: AT,
        },
        TX,
      );
      expect(devices.insertTransition).toHaveBeenCalledWith(
        expect.objectContaining({ fromStatus: null, toStatus: 'IN_INTAKE', reason: 'REGISTERED' }),
        TX,
      );
      expect(view.nodeId).toBe('!a4b1c2d3');
    });

    it('accepts the node id and a decimal string', async () => {
      await service.register({ ...dto, nodeNum: '!A4B1C2D3' }, 's', AT, TX);
      expect((devices.insertDevice.mock.calls[0] as [{ nodeNum: bigint }])[0].nodeNum).toBe(
        0xa4b1c2d3n,
      );
      await service.register({ ...dto, nodeNum: ' 42 ' }, 's', AT, TX);
      expect((devices.insertDevice.mock.calls[1] as [{ nodeNum: bigint }])[0].nodeNum).toBe(42n);
    });

    it.each([[-1], [4294967296], [1.5], ['a4b1c2d3'], ['!zz'], [true as unknown as number]])(
      'refuses the node number %p',
      async (nodeNum) => {
        expect(await codeOf(service.register({ ...dto, nodeNum }, 's', AT, TX))).toBe(
          ErrorCode.VALIDATION_FAILED,
        );
      },
    );

    it('refuses a blank tag, a future or impossible date and an inactive or unknown variant', async () => {
      expect(await codeOf(service.register({ ...dto, assetTag: '  ' }, 's', AT, TX))).toBe(
        ErrorCode.VALIDATION_FAILED,
      );
      expect(
        await codeOf(service.register({ ...dto, acquiredAt: '2026-11-03' }, 's', AT, TX)),
      ).toBe(ErrorCode.VALIDATION_FAILED);
      expect(
        await codeOf(service.register({ ...dto, acquiredAt: '2026-02-31x' }, 's', AT, TX)),
      ).toBe(ErrorCode.VALIDATION_FAILED);
      devices.findVariant.mockResolvedValueOnce({ id: 'v-1', isActive: false });
      expect(await codeOf(service.register(dto, 's', AT, TX))).toBe(ErrorCode.VALIDATION_FAILED);
      devices.findVariant.mockResolvedValueOnce(null);
      expect(await codeOf(service.register(dto, 's', AT, TX))).toBe(ErrorCode.VALIDATION_FAILED);
    });

    it('answers CONFLICT_UNIQUE naming the tag or the node id ever registered (REQ-ERR-01)', async () => {
      devices.findRegistered.mockResolvedValueOnce({ assetTag: 'TL-0042', nodeNum: 1n });
      await expect(service.register(dto, 's', AT, TX)).rejects.toThrow(
        'TL-0042 is already registered.',
      );
      devices.findRegistered.mockResolvedValueOnce({ assetTag: 'TL-0001', nodeNum: 2763113171n });
      await expect(service.register(dto, 's', AT, TX)).rejects.toThrow(
        '!a4b1c2d3 is already registered.',
      );
      devices.findRegistered.mockResolvedValueOnce({ assetTag: 'TL-0042', nodeNum: 1n });
      expect(await codeOf(service.register(dto, 's', AT, TX))).toBe(ErrorCode.CONFLICT_UNIQUE);
    });
  });
});
