import { DeviceStatus } from '@prisma/client';
import { DomainException } from '../../common/errors';
import { DevicesRepository } from './devices.repository';
import { DevicesService } from './devices.service';

const device = {
  id: 'dev-1',
  assetTag: 'TL-0009',
  nodeNum: 0xde000009n,
  status: DeviceStatus.RENTED,
};
const at = new Date('2026-10-23T03:00:00Z');

describe('DevicesService', () => {
  let repository: {
    findByNodeNum: jest.Mock;
    projectIfNewer: jest.Mock;
    findValuation: jest.Mock;
    handoverUnits: jest.Mock;
  };
  let service: DevicesService;

  beforeEach(() => {
    repository = {
      findByNodeNum: jest.fn().mockResolvedValue(device),
      projectIfNewer: jest.fn().mockResolvedValue(true),
      findValuation: jest.fn(),
      handoverUnits: jest.fn(),
    };
    service = new DevicesService(
      repository as unknown as DevicesRepository,
      {} as never,
      {} as never,
    );
  });

  it('reads the handover note units with node id and remaining value at the note time', async () => {
    repository.handoverUnits.mockResolvedValue([
      {
        id: 'dev-1',
        assetTag: 'TL-0001',
        nodeNum: 0xde000001n,
        keyVersion: 2,
        firmwareVersion: '2.5.0',
        acquiredAt: new Date('2025-09-01T00:00:00Z'),
        hardwareVariant: {
          code: 'treklink-v3',
          remainingValueSchedule: [
            { fromMonths: 0, valueVnd: 2_500_000 },
            { fromMonths: 12, valueVnd: 1_800_000 },
          ],
        },
      },
    ]);
    const tx = {} as never;
    const units = await service.handoverUnits(['dev-1'], new Date('2026-11-02T03:00:00Z'), tx);
    expect(units.get('dev-1')).toEqual({
      id: 'dev-1',
      assetTag: 'TL-0001',
      nodeId: '!de000001',
      keyVersion: 2,
      firmwareVersion: '2.5.0',
      variantCode: 'treklink-v3',
      remainingValueVnd: 1_800_000,
    });
    expect(repository.handoverUnits).toHaveBeenCalledWith(['dev-1'], tx);
    await expect(service.handoverUnits([], new Date())).resolves.toEqual(new Map());
  });

  it('projects a position reading and returns the device id', async () => {
    await expect(
      service.projectReading(device.nodeNum, {
        at,
        position: { latitude: 11.55, longitude: 108.54 },
      }),
    ).resolves.toBe('dev-1');
    expect(repository.projectIfNewer).toHaveBeenCalledWith(
      'dev-1',
      { at, latitude: 11.55, longitude: 108.54, batteryPct: undefined },
      undefined,
    );
  });

  it('projects a telemetry reading without touching the position', async () => {
    await service.projectReading(device.nodeNum, { at, batteryPct: 87 });
    expect(repository.projectIfNewer).toHaveBeenCalledWith(
      'dev-1',
      { at, latitude: undefined, longitude: undefined, batteryPct: 87 },
      undefined,
    );
  });

  it('still returns the device id when an older reading is discarded', async () => {
    repository.projectIfNewer.mockResolvedValue(false);
    await expect(service.projectReading(device.nodeNum, { at, batteryPct: 50 })).resolves.toBe(
      'dev-1',
    );
  });

  it('returns null for an unknown node number and projects nothing', async () => {
    repository.findByNodeNum.mockResolvedValue(null);
    await expect(service.projectReading(1n, { at })).resolves.toBeNull();
    expect(repository.projectIfNewer).not.toHaveBeenCalled();
  });

  it('values a device from its variant schedule, or 404 for an unknown device', async () => {
    repository.findValuation.mockResolvedValue({
      acquiredAt: new Date('2025-01-01T00:00:00Z'),
      hardwareVariant: {
        remainingValueSchedule: [
          { fromMonths: 0, valueVnd: 2500000 },
          { fromMonths: 12, valueVnd: 1800000 },
        ],
      },
    });
    await expect(service.valueAt('dev-1', at)).resolves.toBe(1800000);

    repository.findValuation.mockResolvedValue(null);
    await expect(service.valueAt('nope', at)).rejects.toBeInstanceOf(DomainException);
  });

  it('moves a unit that failed the counter check to MAINTENANCE with a HANDOVER_CHECK_FAILED record', async () => {
    const moveWithTransitions = jest.fn().mockResolvedValue(['dev-1']);
    const openForSystem = jest.fn().mockResolvedValue({});
    const tx = {} as never;
    service = new DevicesService(
      { moveWithTransitions } as unknown as DevicesRepository,
      { openForSystem } as never,
      {} as never,
    );

    await service.failHandoverCheck('dev-1', 'No GPS fix', 'u-staff', at, tx, {
      contractId: 'c-1',
      contractCode: 'RC-2026-0002',
    });

    expect(moveWithTransitions).toHaveBeenCalledWith(
      ['dev-1'],
      DeviceStatus.RESERVED,
      DeviceStatus.MAINTENANCE,
      at,
      tx,
      {
        actorId: 'u-staff',
        reason: 'HANDOVER_CHECK_FAILED',
        note: 'RC-2026-0002',
        refType: 'CONTRACT',
        refId: 'c-1',
      },
    );
    expect(openForSystem).toHaveBeenCalledWith(
      {
        deviceId: 'dev-1',
        reason: 'HANDOVER_CHECK_FAILED',
        description: 'Handover check failed: No GPS fix',
        expectedAt: new Date('2026-10-23T00:00:00Z'),
      },
      'u-staff',
      at,
      tx,
    );
  });
});
