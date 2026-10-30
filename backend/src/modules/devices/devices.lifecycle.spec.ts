import { HttpStatus } from '@nestjs/common';
import { DeviceStatus } from '@prisma/client';
import { DomainException, ErrorCode } from '../../common/errors';
import { DevicesRepository } from './devices.repository';
import { DevicesService } from './devices.service';

// Retire (devices api-design 16, task 2.4) and dispose (api-design 23, task 2.7). Design §2: retire
// is MAINTENANCE to RETIRED only, dispose is RETIRED to DISPOSED with the wipe recorded (BR-42).
const at = new Date('2026-10-30T03:00:00Z');
const tx = {} as never;

const detailRow = (status: DeviceStatus, version: number) => ({
  id: 'dev-1',
  assetTag: 'TL-0019',
  nodeNum: 0xde000019n,
  hardwareVariant: { id: 'v-3', code: 'treklink-v3' },
  firmwareVersion: '2.7.19-treklink.3',
  acquiredAt: new Date('2026-06-15T00:00:00Z'),
  status,
  statusChangedAt: at,
  keyVersion: null,
  keyOrganizationId: null,
  batteryPct: null,
  lastSeenAt: null,
  lastLatitude: null,
  lastLongitude: null,
  serviceDueAt: null,
  version,
});

const expectDomain = async (promise: Promise<unknown>, status: HttpStatus, code: ErrorCode) => {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(DomainException);
  expect((error as DomainException).getStatus()).toBe(status);
  expect(JSON.stringify((error as DomainException).getResponse())).toContain(code);
};

describe('DevicesService retire and dispose', () => {
  let repository: {
    findUnit: jest.Mock;
    moveIfCurrent: jest.Mock;
    insertTransition: jest.Mock;
    insertDisposal: jest.Mock;
    findDetail: jest.Mock;
  };
  let maintenance: { hasOpenRecord: jest.Mock };
  let service: DevicesService;

  const unitAt = (status: DeviceStatus, version = 4) =>
    repository.findUnit.mockResolvedValue({ id: 'dev-1', status, version });

  beforeEach(() => {
    repository = {
      findUnit: jest.fn(),
      moveIfCurrent: jest.fn().mockResolvedValue(true),
      insertTransition: jest.fn(),
      insertDisposal: jest.fn(),
      findDetail: jest.fn(),
    };
    maintenance = { hasOpenRecord: jest.fn().mockResolvedValue(false) };
    service = new DevicesService(
      repository as unknown as DevicesRepository,
      maintenance as never,
      {
        labelsOf: jest.fn().mockResolvedValue(new Map()),
      } as never,
    );
  });

  describe('retire', () => {
    const dto = { reason: '  Unrepairable water damage ', expectedVersion: 4 };

    it('moves a MAINTENANCE device to RETIRED with reason RETIRED and the text as note', async () => {
      unitAt(DeviceStatus.MAINTENANCE);
      repository.findDetail.mockResolvedValue(detailRow(DeviceStatus.RETIRED, 5));

      const device = await service.retire('dev-1', dto, 'admin-1', at, tx);

      expect(device).toMatchObject({ id: 'dev-1', status: DeviceStatus.RETIRED, version: 5 });
      expect(device.keyOrganization).toBeNull();
      expect(repository.moveIfCurrent).toHaveBeenCalledWith(
        'dev-1',
        4,
        [DeviceStatus.MAINTENANCE],
        DeviceStatus.RETIRED,
        at,
        tx,
        { retiredAt: at },
      );
      expect(repository.insertTransition).toHaveBeenCalledWith(
        {
          deviceId: 'dev-1',
          fromStatus: DeviceStatus.MAINTENANCE,
          toStatus: DeviceStatus.RETIRED,
          actorId: 'admin-1',
          reason: 'RETIRED',
          note: 'Unrepairable water damage',
          createdAt: at,
        },
        tx,
      );
    });

    it.each([
      DeviceStatus.AVAILABLE,
      DeviceStatus.RESERVED,
      DeviceStatus.RENTED,
      DeviceStatus.RETURNED,
      DeviceStatus.LOST,
      DeviceStatus.RETIRED,
      DeviceStatus.DISPOSED,
    ])('refuses a %s device with 409 INVALID_STATE_TRANSITION', async (status) => {
      unitAt(status);
      await expectDomain(
        service.retire('dev-1', dto, 'admin-1', at, tx),
        HttpStatus.CONFLICT,
        ErrorCode.INVALID_STATE_TRANSITION,
      );
      expect(repository.moveIfCurrent).not.toHaveBeenCalled();
      expect(repository.insertTransition).not.toHaveBeenCalled();
    });

    it('refuses a device with an open maintenance record with 409 MAINTENANCE_OPEN', async () => {
      unitAt(DeviceStatus.MAINTENANCE);
      maintenance.hasOpenRecord.mockResolvedValue(true);
      await expectDomain(
        service.retire('dev-1', dto, 'admin-1', at, tx),
        HttpStatus.CONFLICT,
        ErrorCode.MAINTENANCE_OPEN,
      );
      expect(maintenance.hasOpenRecord).toHaveBeenCalledWith('dev-1', tx);
      expect(repository.moveIfCurrent).not.toHaveBeenCalled();
      expect(repository.insertTransition).not.toHaveBeenCalled();
    });

    it('refuses a stale expectedVersion with 409 STALE_VERSION', async () => {
      unitAt(DeviceStatus.MAINTENANCE, 6);
      await expectDomain(
        service.retire('dev-1', dto, 'admin-1', at, tx),
        HttpStatus.CONFLICT,
        ErrorCode.STALE_VERSION,
      );
      expect(repository.moveIfCurrent).not.toHaveBeenCalled();
    });

    it('refuses with 409 STALE_VERSION when a concurrent write wins the conditional move', async () => {
      unitAt(DeviceStatus.MAINTENANCE);
      repository.moveIfCurrent.mockResolvedValue(false);
      await expectDomain(
        service.retire('dev-1', dto, 'admin-1', at, tx),
        HttpStatus.CONFLICT,
        ErrorCode.STALE_VERSION,
      );
      expect(repository.insertTransition).not.toHaveBeenCalled();
    });

    it('answers 404 NOT_FOUND for an unknown device', async () => {
      repository.findUnit.mockResolvedValue(null);
      await expectDomain(
        service.retire('nope', dto, 'admin-1', at, tx),
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
      );
    });
  });

  describe('dispose', () => {
    const dto = {
      keyRemoved: true,
      nodeDbCleared: true,
      ownerCleared: true,
      method: ' Recycled through a licensed handler ',
      expectedVersion: 4,
    };

    it('records the wipe and moves a RETIRED device to DISPOSED', async () => {
      unitAt(DeviceStatus.RETIRED);
      repository.findDetail.mockResolvedValue(detailRow(DeviceStatus.DISPOSED, 5));

      await expect(service.dispose('dev-1', dto, 'admin-1', at, tx)).resolves.toMatchObject({
        status: DeviceStatus.DISPOSED,
        version: 5,
      });
      expect(repository.insertDisposal).toHaveBeenCalledWith(
        'dev-1',
        {
          keyRemoved: true,
          nodeDbCleared: true,
          ownerCleared: true,
          method: 'Recycled through a licensed handler',
        },
        'admin-1',
        at,
        tx,
      );
      expect(repository.moveIfCurrent).toHaveBeenCalledWith(
        'dev-1',
        4,
        [DeviceStatus.RETIRED],
        DeviceStatus.DISPOSED,
        at,
        tx,
      );
      expect(repository.insertTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          fromStatus: DeviceStatus.RETIRED,
          toStatus: DeviceStatus.DISPOSED,
          actorId: 'admin-1',
        }),
        tx,
      );
    });

    it.each(['keyRemoved', 'nodeDbCleared', 'ownerCleared'])(
      'refuses with 400 WIPE_INCOMPLETE when %s is false',
      async (step) => {
        unitAt(DeviceStatus.RETIRED);
        await expectDomain(
          service.dispose('dev-1', { ...dto, [step]: false }, 'admin-1', at, tx),
          HttpStatus.BAD_REQUEST,
          ErrorCode.WIPE_INCOMPLETE,
        );
        expect(repository.insertDisposal).not.toHaveBeenCalled();
        expect(repository.moveIfCurrent).not.toHaveBeenCalled();
      },
    );

    it.each([
      DeviceStatus.AVAILABLE,
      DeviceStatus.RENTED,
      DeviceStatus.MAINTENANCE,
      DeviceStatus.LOST,
      DeviceStatus.DISPOSED,
    ])('refuses a %s device with 409 INVALID_STATE_TRANSITION', async (status) => {
      unitAt(status);
      await expectDomain(
        service.dispose('dev-1', dto, 'admin-1', at, tx),
        HttpStatus.CONFLICT,
        ErrorCode.INVALID_STATE_TRANSITION,
      );
      expect(repository.insertDisposal).not.toHaveBeenCalled();
    });

    it('refuses a stale expectedVersion with 409 STALE_VERSION and writes no disposal', async () => {
      unitAt(DeviceStatus.RETIRED, 7);
      await expectDomain(
        service.dispose('dev-1', dto, 'admin-1', at, tx),
        HttpStatus.CONFLICT,
        ErrorCode.STALE_VERSION,
      );
      expect(repository.insertDisposal).not.toHaveBeenCalled();
    });

    it('refuses with 409 STALE_VERSION when a concurrent write wins the conditional move', async () => {
      unitAt(DeviceStatus.RETIRED);
      repository.moveIfCurrent.mockResolvedValue(false);
      await expectDomain(
        service.dispose('dev-1', dto, 'admin-1', at, tx),
        HttpStatus.CONFLICT,
        ErrorCode.STALE_VERSION,
      );
      expect(repository.insertTransition).not.toHaveBeenCalled();
    });

    it('answers 404 NOT_FOUND for an unknown device', async () => {
      repository.findUnit.mockResolvedValue(null);
      await expectDomain(
        service.dispose('nope', dto, 'admin-1', at, tx),
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
      );
    });
  });

  describe('trail (monitoring api-design 07)', () => {
    it('shows the retire reason code with the free-text note', async () => {
      unitAt(DeviceStatus.RETIRED);
      const lifecycle = jest.fn().mockResolvedValue({
        transitions: [
          {
            id: 't-1',
            fromStatus: DeviceStatus.MAINTENANCE,
            toStatus: DeviceStatus.RETIRED,
            actorId: 'admin-1',
            reason: 'RETIRED',
            note: 'Unrepairable water damage',
            refType: null,
            refId: null,
            createdAt: at,
          },
        ],
        intakeChecks: [],
        provisionings: [],
        resets: [],
        inspections: [],
      });
      Object.assign(repository, { lifecycle });
      Object.assign(maintenance, { ofDevice: jest.fn().mockResolvedValue([]) });

      const [entry] = await service.trail('dev-1');

      expect(entry.summary).toBe('MAINTENANCE to RETIRED (Retired): Unrepairable water damage');
    });
  });
});
