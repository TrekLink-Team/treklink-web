import { HttpStatus } from '@nestjs/common';
import { DeviceStatus, InspectionResult } from '@prisma/client';
import { DomainException, ErrorCode } from '../../common/errors';
import { DevicesRepository } from './devices.repository';
import { DevicesService } from './devices.service';

// The reset of a returned unit (devices api-design 10) and what the return counter reads of each
// returned contract row (rentals api-design 03 devices[]): one reset per return, and the reset and
// inspection survive a reload of the counter (demo smoke defect 4, 2026-10-30).
const returnedAt = new Date('2026-10-30T03:00:00Z');
const at = new Date('2026-10-30T03:10:00Z');
const tx = {} as never;
const steps = { keyRemoved: true, nodeDbCleared: true, ownerCleared: true };

const expectDomain = async (promise: Promise<unknown>, status: HttpStatus, code: ErrorCode) => {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(DomainException);
  expect((error as DomainException).getStatus()).toBe(status);
  expect(JSON.stringify((error as DomainException).getResponse())).toContain(code);
};

describe('DevicesService reset and return checks', () => {
  let repository: {
    lockUnit: jest.Mock;
    lastResetAt: jest.Mock;
    insertReset: jest.Mock;
    resetsOf: jest.Mock;
    returnsOf: jest.Mock;
    inspectionsOfContractDevices: jest.Mock;
    findUnit: jest.Mock;
    insertInspection: jest.Mock;
  };
  let custody: { custodyAt: jest.Mock };
  let service: DevicesService;

  // The interval of a renter still holding the unit on its contract (no check-in, no lostAt).
  const OPEN_ROW = { contractId: 'c-1', organizationId: 'org-1', contractDeviceId: 'cd-1' };

  beforeEach(() => {
    repository = {
      lockUnit: jest.fn().mockResolvedValue({
        id: 'dev-1',
        status: DeviceStatus.RETURNED,
        statusChangedAt: returnedAt,
        version: 4,
      }),
      lastResetAt: jest.fn().mockResolvedValue(null),
      insertReset: jest.fn().mockResolvedValue({ id: 'dev-1', version: 5 }),
      resetsOf: jest.fn().mockResolvedValue([]),
      returnsOf: jest.fn().mockResolvedValue([]),
      inspectionsOfContractDevices: jest.fn().mockResolvedValue([]),
      findUnit: jest.fn().mockResolvedValue({ id: 'dev-1', status: DeviceStatus.RETURNED }),
      insertInspection: jest.fn(),
    };
    custody = { custodyAt: jest.fn().mockResolvedValue(null) };
    service = new DevicesService(
      repository as unknown as DevicesRepository,
      {} as never,
      {} as never,
      custody,
    );
  });

  describe('reset', () => {
    it('records the first reset of a return', async () => {
      await service.reset('dev-1', steps, 'staff-1', at, tx);

      expect(repository.insertReset).toHaveBeenCalledWith('dev-1', steps, 'staff-1', at, tx);
    });

    it('locks the device row before it checks for an earlier reset', async () => {
      await service.reset('dev-1', steps, 'staff-1', at, tx);

      expect(repository.lockUnit).toHaveBeenCalledWith('dev-1', tx);
      expect(repository.lockUnit.mock.invocationCallOrder[0]).toBeLessThan(
        repository.lastResetAt.mock.invocationCallOrder[0],
      );
    });

    it('records a reset when the last one was before this return', async () => {
      repository.lastResetAt.mockResolvedValue(new Date('2026-09-01T00:00:00Z'));

      await service.reset('dev-1', steps, 'staff-1', at, tx);

      expect(repository.insertReset).toHaveBeenCalled();
    });

    it('refuses a second reset of the same return with 409 ALREADY_RESET', async () => {
      repository.lastResetAt.mockResolvedValue(new Date('2026-10-30T03:05:00Z'));

      await expectDomain(
        service.reset('dev-1', steps, 'staff-1', at, tx),
        HttpStatus.CONFLICT,
        ErrorCode.ALREADY_RESET,
      );
      expect(repository.lastResetAt).toHaveBeenCalledWith('dev-1', tx);
      expect(repository.insertReset).not.toHaveBeenCalled();
    });

    it('refuses a unit whose contract row is still open until it is checked in (design §2.1)', async () => {
      custody.custodyAt.mockResolvedValue(OPEN_ROW);

      await expectDomain(
        service.reset('dev-1', steps, 'staff-1', at, tx),
        HttpStatus.CONFLICT,
        ErrorCode.INVALID_STATE_TRANSITION,
      );
      expect(custody.custodyAt).toHaveBeenCalledWith('dev-1', at, tx);
      expect(repository.insertReset).not.toHaveBeenCalled();
    });

    it('still refuses an incomplete reset before looking at earlier resets', async () => {
      await expectDomain(
        service.reset('dev-1', { ...steps, ownerCleared: false }, 'staff-1', at, tx),
        HttpStatus.BAD_REQUEST,
        ErrorCode.RESET_INCOMPLETE,
      );
      expect(repository.lastResetAt).not.toHaveBeenCalled();
    });
  });

  describe('recordInspection', () => {
    it('refuses to inspect a unit whose contract row is still open, so it never reaches AVAILABLE', async () => {
      custody.custodyAt.mockResolvedValue(OPEN_ROW);

      await expectDomain(
        service.recordInspection(
          'dev-1',
          {
            result: InspectionResult.PASSED,
            damageCodes: [],
            note: null,
            contractDeviceId: 'cd-1',
            checkedInAt: at,
          },
          'staff-1',
          at,
          tx,
        ),
        HttpStatus.CONFLICT,
        ErrorCode.INVALID_STATE_TRANSITION,
      );
      expect(custody.custodyAt).toHaveBeenCalledWith('dev-1', at, tx);
      expect(repository.lastResetAt).not.toHaveBeenCalled();
      expect(repository.insertInspection).not.toHaveBeenCalled();
    });
  });

  describe('returnChecks', () => {
    it('reads nothing when no row is checked in', async () => {
      const checks = await service.returnChecks([
        { contractDeviceId: 'cd-1', deviceId: 'dev-1', checkedInAt: null },
      ]);

      expect(checks.size).toBe(0);
      expect(repository.resetsOf).not.toHaveBeenCalled();
    });

    it('takes the first reset at or after the check-in and the last inspection of the row', async () => {
      repository.resetsOf.mockResolvedValue([
        { deviceId: 'dev-1', createdAt: new Date('2026-09-01T00:00:00Z') },
        { deviceId: 'dev-1', createdAt: new Date('2026-10-30T03:05:00Z') },
        { deviceId: 'dev-1', createdAt: new Date('2026-11-20T00:00:00Z') },
      ]);
      repository.inspectionsOfContractDevices.mockResolvedValue([
        {
          contractDeviceId: 'cd-1',
          result: InspectionResult.PASSED,
          createdAt: new Date('2026-10-30T03:06:00Z'),
        },
        {
          contractDeviceId: 'cd-other',
          result: InspectionResult.FAILED,
          createdAt: new Date('2026-10-30T03:07:00Z'),
        },
      ]);

      const checks = await service.returnChecks([
        { contractDeviceId: 'cd-1', deviceId: 'dev-1', checkedInAt: returnedAt },
        { contractDeviceId: 'cd-2', deviceId: 'dev-2', checkedInAt: returnedAt },
        { contractDeviceId: 'cd-3', deviceId: 'dev-3', checkedInAt: null },
      ]);

      expect(repository.resetsOf).toHaveBeenCalledWith(['dev-1', 'dev-2']);
      expect(repository.returnsOf).toHaveBeenCalledWith(['dev-1', 'dev-2']);
      expect(repository.inspectionsOfContractDevices).toHaveBeenCalledWith(['cd-1', 'cd-2']);
      expect(checks.get('cd-1')).toEqual({
        resetAt: new Date('2026-10-30T03:05:00Z'),
        inspection: { result: InspectionResult.PASSED, at: new Date('2026-10-30T03:06:00Z') },
      });
      expect(checks.get('cd-2')).toEqual({ resetAt: null, inspection: null });
      expect(checks.has('cd-3')).toBe(false);
    });

    it('shows no reset when the only later one follows the next return of the unit', async () => {
      const nextReturn = new Date('2026-11-20T00:00:00Z');
      repository.returnsOf.mockResolvedValue([
        { deviceId: 'dev-1', createdAt: returnedAt },
        { deviceId: 'dev-1', createdAt: nextReturn },
      ]);
      repository.resetsOf.mockResolvedValue([
        { deviceId: 'dev-1', createdAt: new Date('2026-11-20T00:05:00Z') },
      ]);

      const checks = await service.returnChecks([
        { contractDeviceId: 'cd-1', deviceId: 'dev-1', checkedInAt: returnedAt },
        { contractDeviceId: 'cd-9', deviceId: 'dev-1', checkedInAt: nextReturn },
      ]);

      expect(checks.get('cd-1')?.resetAt).toBeNull();
      expect(checks.get('cd-9')?.resetAt).toEqual(new Date('2026-11-20T00:05:00Z'));
    });

    it('keeps a reset made before the next return of the unit', async () => {
      repository.returnsOf.mockResolvedValue([
        { deviceId: 'dev-1', createdAt: returnedAt },
        { deviceId: 'dev-1', createdAt: new Date('2026-11-20T00:00:00Z') },
      ]);
      repository.resetsOf.mockResolvedValue([
        { deviceId: 'dev-1', createdAt: new Date('2026-10-30T03:05:00Z') },
      ]);

      const checks = await service.returnChecks([
        { contractDeviceId: 'cd-1', deviceId: 'dev-1', checkedInAt: returnedAt },
      ]);

      expect(checks.get('cd-1')?.resetAt).toEqual(new Date('2026-10-30T03:05:00Z'));
    });
  });
});
