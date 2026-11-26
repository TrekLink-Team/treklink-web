import { HttpStatus } from '@nestjs/common';
import { DeviceStatus, InspectionResult } from '@prisma/client';
import { DomainException, ErrorCode } from '../../common/errors';
import { DevicesRepository } from './devices.repository';
import { DevicesService } from './devices.service';

// devices api-design 35 (D-114, REQ-EVT-11): the inspection of a RETURNED unit recovered outside a
// contract. It is the counter's recordInspection with no contract row and the recovery as the check-in.
const recoveredAt = new Date('2026-11-20T02:00:00Z');
const at = new Date('2026-11-26T03:00:00Z');
const tx = {} as never;

const expectDomain = async (promise: Promise<unknown>, status: HttpStatus, code: ErrorCode) => {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(DomainException);
  expect((error as DomainException).getStatus()).toBe(status);
  expect(JSON.stringify((error as DomainException).getResponse())).toContain(code);
};

describe('DevicesService.inspectRecovered (D-114)', () => {
  let repository: {
    lockUnit: jest.Mock;
    lastReturnMove: jest.Mock;
    findUnit: jest.Mock;
    lastResetAt: jest.Mock;
    insertInspection: jest.Mock;
    findDetail: jest.Mock;
    moveStatus: jest.Mock;
    insertTransition: jest.Mock;
  };
  let maintenance: { dueReason: jest.Mock; openForSystem: jest.Mock };
  let custody: { custodyAt: jest.Mock };
  let service: DevicesService;

  const unit = {
    id: 'dev-1',
    assetTag: 'TL-0031',
    hardwareVariantId: 'v-3',
    status: DeviceStatus.RETURNED,
    statusChangedAt: recoveredAt,
    keyVersion: null,
    keyOrganizationId: null,
    version: 7,
  };
  const passed = { result: InspectionResult.PASSED, damageCodes: [], note: null };

  beforeEach(() => {
    repository = {
      lockUnit: jest.fn().mockResolvedValue(unit),
      lastReturnMove: jest.fn().mockResolvedValue({
        refType: 'LOSS_CASE',
        createdAt: recoveredAt,
        lossCaseContractId: null,
      }),
      findUnit: jest.fn().mockResolvedValue(unit),
      // Reset after the recovery.
      lastResetAt: jest.fn().mockResolvedValue(new Date('2026-11-26T02:50:00Z')),
      insertInspection: jest
        .fn()
        .mockResolvedValue({ id: 'in-1', result: InspectionResult.PASSED }),
      findDetail: jest.fn().mockResolvedValue({
        serviceDueAt: null,
        firmwareVersion: '2.7.19-treklink.3',
        hardwareVariant: { firmwareBaseline: '2.7.19-treklink.3' },
      }),
      moveStatus: jest.fn(),
      insertTransition: jest.fn(),
    };
    maintenance = { dueReason: jest.fn().mockResolvedValue(null), openForSystem: jest.fn() };
    custody = { custodyAt: jest.fn().mockResolvedValue(null) };
    service = new DevicesService(
      repository as unknown as DevicesRepository,
      maintenance as never,
      {} as never,
      custody,
    );
  });

  it('moves a reset unit to AVAILABLE on PASSED, with no contract row on the inspection', async () => {
    const result = await service.inspectRecovered('dev-1', passed, 'staff-1', at, tx);

    expect(result.device).toEqual({
      id: 'dev-1',
      assetTag: 'TL-0031',
      status: DeviceStatus.AVAILABLE,
    });
    expect(repository.lockUnit).toHaveBeenCalledWith('dev-1', tx);
    expect(repository.insertInspection).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: 'dev-1', contractDeviceId: null, result: 'PASSED' }),
      tx,
    );
    expect(repository.moveStatus).toHaveBeenCalledWith(
      ['dev-1'],
      DeviceStatus.RETURNED,
      DeviceStatus.AVAILABLE,
      at,
      tx,
    );
    expect(repository.insertTransition).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'INSPECTION_PASSED', toStatus: DeviceStatus.AVAILABLE }),
      tx,
    );
    expect(maintenance.openForSystem).not.toHaveBeenCalled();
  });

  it('sends a DAMAGED unit to MAINTENANCE with an INSPECTION_FAILED record naming the codes', async () => {
    const result = await service.inspectRecovered(
      'dev-1',
      { result: InspectionResult.DAMAGED, damageCodes: ['ANTENNA_BROKEN'], note: 'Snapped' },
      'staff-1',
      at,
      tx,
    );

    expect(result.device.status).toBe(DeviceStatus.MAINTENANCE);
    expect(repository.insertInspection).toHaveBeenCalledWith(
      expect.objectContaining({
        result: 'DAMAGED',
        damageCodes: ['ANTENNA_BROKEN'],
        contractDeviceId: null,
      }),
      tx,
    );
    expect(maintenance.openForSystem).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: 'dev-1',
        reason: 'INSPECTION_FAILED',
        description: 'Inspection damaged: ANTENNA_BROKEN; Snapped.',
      }),
      'staff-1',
      at,
      tx,
    );
  });

  it('sends a FAILED unit to MAINTENANCE', async () => {
    const result = await service.inspectRecovered(
      'dev-1',
      { result: InspectionResult.FAILED, damageCodes: [], note: null },
      'staff-1',
      at,
      tx,
    );
    expect(result.device.status).toBe(DeviceStatus.MAINTENANCE);
  });

  it('refuses a unit not reset since its recovery with 409 RESET_REQUIRED', async () => {
    repository.lastResetAt.mockResolvedValue(new Date('2026-11-01T00:00:00Z'));
    await expectDomain(
      service.inspectRecovered('dev-1', passed, 'staff-1', at, tx),
      HttpStatus.CONFLICT,
      ErrorCode.RESET_REQUIRED,
    );
    repository.lastResetAt.mockResolvedValue(null);
    await expectDomain(
      service.inspectRecovered('dev-1', passed, 'staff-1', at, tx),
      HttpStatus.CONFLICT,
      ErrorCode.RESET_REQUIRED,
    );
    expect(repository.insertInspection).not.toHaveBeenCalled();
    expect(repository.moveStatus).not.toHaveBeenCalled();
  });

  it.each([
    [
      'came back at a check-in',
      { refType: 'CONTRACT', createdAt: recoveredAt, lossCaseContractId: null },
    ],
    [
      'was recovered from a loss case that names a contract',
      { refType: 'LOSS_CASE', createdAt: recoveredAt, lossCaseContractId: 'c-7' },
    ],
  ])('refuses a unit that %s: its counter inspects it (409)', async (_case, move) => {
    repository.lastReturnMove.mockResolvedValue(move);
    await expectDomain(
      service.inspectRecovered('dev-1', passed, 'staff-1', at, tx),
      HttpStatus.CONFLICT,
      ErrorCode.INVALID_STATE_TRANSITION,
    );
    expect(repository.insertInspection).not.toHaveBeenCalled();
    expect(repository.moveStatus).not.toHaveBeenCalled();
  });

  it('refuses a unit whose contract row is still open, as the counter does', async () => {
    custody.custodyAt.mockResolvedValue({
      contractId: 'c-1',
      organizationId: 'o-1',
      contractDeviceId: 'cd-1',
    });
    await expectDomain(
      service.inspectRecovered('dev-1', passed, 'staff-1', at, tx),
      HttpStatus.CONFLICT,
      ErrorCode.INVALID_STATE_TRANSITION,
    );
    expect(repository.insertInspection).not.toHaveBeenCalled();
  });

  it('refuses a unit that is not RETURNED, and a missing one', async () => {
    repository.lockUnit.mockResolvedValue({ ...unit, status: DeviceStatus.AVAILABLE });
    await expectDomain(
      service.inspectRecovered('dev-1', passed, 'staff-1', at, tx),
      HttpStatus.CONFLICT,
      ErrorCode.INVALID_STATE_TRANSITION,
    );
    repository.lockUnit.mockResolvedValue(null);
    await expectDomain(
      service.inspectRecovered('dev-1', passed, 'staff-1', at, tx),
      HttpStatus.NOT_FOUND,
      ErrorCode.NOT_FOUND,
    );
    expect(repository.lastReturnMove).not.toHaveBeenCalled();
  });

  it('requires damage codes for DAMAGED (400 VALIDATION_FAILED) before any read', async () => {
    await expectDomain(
      service.inspectRecovered(
        'dev-1',
        { result: InspectionResult.DAMAGED, damageCodes: [], note: null },
        'staff-1',
        at,
        tx,
      ),
      HttpStatus.BAD_REQUEST,
      ErrorCode.VALIDATION_FAILED,
    );
    expect(repository.lockUnit).not.toHaveBeenCalled();
  });
});
