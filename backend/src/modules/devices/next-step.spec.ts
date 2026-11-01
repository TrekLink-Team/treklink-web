import { DeviceStatus } from '@prisma/client';
import { DevicesRepository } from './devices.repository';
import { DevicesService } from './devices.service';
import { MaintenanceService } from './maintenance.service';
import { nextStepOf } from './next-step';

// devices REQ-EVT-23 (D-092 rule 4): the next step of a unit back to AVAILABLE, for the device page
// (api-design 07) and the checked-in rows of a contract (rentals api-design 03).
describe('nextStepOf', () => {
  const base = { resetSinceReturn: false, openMaintenance: false, returnContractId: 'c-1' };

  it('asks a RETURNED unit for its reset, then its inspection, at the counter of its contract', () => {
    expect(nextStepOf({ ...base, status: DeviceStatus.RETURNED })).toEqual({
      action: 'RESET',
      contractId: 'c-1',
    });
    expect(nextStepOf({ ...base, status: DeviceStatus.RETURNED, resetSinceReturn: true })).toEqual({
      action: 'INSPECT',
      contractId: 'c-1',
    });
  });

  it('sends a MAINTENANCE unit to its open record, then to the intake check', () => {
    expect(
      nextStepOf({ ...base, status: DeviceStatus.MAINTENANCE, openMaintenance: true }),
    ).toEqual({ action: 'COMPLETE_MAINTENANCE', contractId: null });
    expect(nextStepOf({ ...base, status: DeviceStatus.MAINTENANCE })).toEqual({
      action: 'INTAKE',
      contractId: null,
    });
    expect(nextStepOf({ ...base, status: DeviceStatus.IN_INTAKE })).toEqual({
      action: 'INTAKE',
      contractId: null,
    });
  });

  it.each([
    DeviceStatus.AVAILABLE,
    DeviceStatus.RESERVED,
    DeviceStatus.RENTED,
    DeviceStatus.LOST,
    DeviceStatus.RETIRED,
    DeviceStatus.DISPOSED,
  ])(
    'has no step for %s: a passed inspection needs no intake (leader ruling 2026-11-01)',
    (status) => {
      expect(nextStepOf({ ...base, status })).toBeNull();
    },
  );
});

describe('DevicesService.nextSteps and openLossCases', () => {
  const returnedAt = new Date('2026-11-01T03:00:00Z');
  let repository: { returnStates: jest.Mock; openLossCases: jest.Mock };
  let maintenance: { openDeviceIds: jest.Mock };
  let service: DevicesService;

  beforeEach(() => {
    repository = {
      returnStates: jest.fn(),
      openLossCases: jest.fn().mockResolvedValue([]),
    };
    maintenance = { openDeviceIds: jest.fn().mockResolvedValue(new Set(['d-3'])) };
    service = new DevicesService(
      repository as unknown as DevicesRepository,
      maintenance as unknown as MaintenanceService,
      {} as never,
      {} as never,
    );
  });

  it('counts a reset only since the unit became RETURNED and names the contract of its check-in', async () => {
    repository.returnStates.mockResolvedValue({
      units: [
        { id: 'd-1', status: DeviceStatus.RETURNED, statusChangedAt: returnedAt },
        { id: 'd-2', status: DeviceStatus.RETURNED, statusChangedAt: returnedAt },
        { id: 'd-3', status: DeviceStatus.MAINTENANCE, statusChangedAt: returnedAt },
        { id: 'd-4', status: DeviceStatus.AVAILABLE, statusChangedAt: returnedAt },
        { id: 'd-5', status: DeviceStatus.RETURNED, statusChangedAt: returnedAt },
      ],
      // Newest first, as the repository orders them.
      resets: [
        { deviceId: 'd-1', createdAt: new Date('2026-11-01T03:05:00Z') },
        { deviceId: 'd-2', createdAt: new Date('2026-10-01T03:05:00Z') },
      ],
      returns: [
        { deviceId: 'd-1', refType: 'CONTRACT', refId: 'c-9', createdAt: returnedAt },
        { deviceId: 'd-1', refType: 'CONTRACT', refId: 'c-1', createdAt: new Date('2026-10-01') },
        { deviceId: 'd-2', refType: 'CONTRACT', refId: 'c-9', createdAt: returnedAt },
        { deviceId: 'd-3', refType: 'CONTRACT', refId: 'c-9', createdAt: returnedAt },
        { deviceId: 'd-5', refType: 'LOSS_CASE', refId: 'lc-1', createdAt: returnedAt },
      ],
    });

    const states = await service.nextSteps(['d-1', 'd-2', 'd-3', 'd-4', 'd-5', 'd-1']);

    expect(repository.returnStates).toHaveBeenCalledWith(
      ['d-1', 'd-2', 'd-3', 'd-4', 'd-5'],
      undefined,
    );
    expect(states.get('d-1')).toEqual({
      status: DeviceStatus.RETURNED,
      nextStep: { action: 'INSPECT', contractId: 'c-9' },
      lastReturnContractId: 'c-9',
    });
    // A reset of an earlier return does not count for this one.
    expect(states.get('d-2')?.nextStep).toEqual({ action: 'RESET', contractId: 'c-9' });
    expect(states.get('d-3')?.nextStep).toEqual({
      action: 'COMPLETE_MAINTENANCE',
      contractId: null,
    });
    expect(states.get('d-4')).toEqual({
      status: DeviceStatus.AVAILABLE,
      nextStep: null,
      lastReturnContractId: null,
    });
    // Recovered outside a contract: no counter to name.
    expect(states.get('d-5')).toEqual({
      status: DeviceStatus.RETURNED,
      nextStep: { action: 'RESET', contractId: null },
      lastReturnContractId: null,
    });
  });

  it('reads nothing for no unit', async () => {
    await expect(service.nextSteps([])).resolves.toEqual(new Map());
    expect(repository.returnStates).not.toHaveBeenCalled();
  });

  it('keeps the newest open loss case of each unit', async () => {
    repository.openLossCases.mockResolvedValue([
      { id: 'lc-2', code: 'LOSS-0002', state: 'REPORTED', deviceId: 'd-1' },
      { id: 'lc-1', code: 'LOSS-0001', state: 'CONFIRMED', deviceId: 'd-1' },
      { id: 'lc-3', code: 'LOSS-0003', state: 'SEARCHING', deviceId: 'd-2' },
    ]);
    const cases = await service.openLossCases(['d-1', 'd-2', 'd-3'], {} as never);
    expect(cases.get('d-1')).toEqual({ id: 'lc-2', code: 'LOSS-0002', state: 'REPORTED' });
    expect(cases.get('d-2')?.code).toBe('LOSS-0003');
    expect(cases.has('d-3')).toBe(false);
  });
});
