import { HttpStatus } from '@nestjs/common';
import { DeviceStatus } from '@prisma/client';
import { DomainException, ErrorCode } from '../../common/errors';
import { DevicesRepository } from './devices.repository';
import { DevicesService } from './devices.service';

// devices api-design 08 (FR-DEV-01): the firmware edit is a compare-and-set of one field; the state
// never moves and no transition row is written.
const tx = {} as never;

const detailRow = (firmwareVersion: string, version: number) => ({
  id: 'dev-1',
  assetTag: 'TL-0019',
  nodeNum: 0xde000019n,
  hardwareVariant: { id: 'v-3', code: 'treklink-v3' },
  firmwareVersion,
  acquiredAt: new Date('2026-06-15T00:00:00Z'),
  status: DeviceStatus.AVAILABLE,
  statusChangedAt: new Date('2026-10-30T03:00:00Z'),
  keyVersion: null,
  keyOrganizationId: null,
  batteryPct: null,
  lastSeenAt: null,
  lastLatitude: null,
  lastLongitude: null,
  serviceDueAt: null,
  version,
});

const codeOf = async (promise: Promise<unknown>): Promise<[number, string]> => {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(DomainException);
  const domain = error as DomainException;
  return [domain.getStatus(), JSON.stringify(domain.getResponse())];
};

describe('DevicesService.updateFirmware (devices api-design 08)', () => {
  let repository: {
    findDetail: jest.Mock;
    setFirmwareIfCurrent: jest.Mock;
    insertTransition: jest.Mock;
  };
  let service: DevicesService;

  beforeEach(() => {
    repository = {
      findDetail: jest.fn(),
      setFirmwareIfCurrent: jest.fn().mockResolvedValue(true),
      insertTransition: jest.fn(),
    };
    service = new DevicesService(
      repository as unknown as DevicesRepository,
      {} as never,
      { labelsOf: jest.fn().mockResolvedValue(new Map()) } as never,
      { custodyAt: () => Promise.resolve(null) },
    );
  });

  it('writes the trimmed version on the loaded version and returns the one before', async () => {
    repository.findDetail
      .mockResolvedValueOnce(detailRow('2.7.19-treklink.3', 5))
      .mockResolvedValueOnce(detailRow('2.7.19-treklink.4', 6));
    const result = await service.updateFirmware(
      'dev-1',
      { firmwareVersion: ' 2.7.19-treklink.4 ', expectedVersion: 5 },
      tx,
    );
    expect(repository.setFirmwareIfCurrent).toHaveBeenCalledWith(
      'dev-1',
      5,
      '2.7.19-treklink.4',
      tx,
    );
    expect(result.before).toBe('2.7.19-treklink.3');
    expect(result.device).toMatchObject({ firmwareVersion: '2.7.19-treklink.4', version: 6 });
    expect(repository.insertTransition).not.toHaveBeenCalled();
  });

  it('answers 404 NOT_FOUND for an unknown device', async () => {
    repository.findDetail.mockResolvedValue(null);
    const [status, body] = await codeOf(
      service.updateFirmware('nope', { firmwareVersion: 'x', expectedVersion: 0 }, tx),
    );
    expect(status).toBe(HttpStatus.NOT_FOUND);
    expect(body).toContain(ErrorCode.NOT_FOUND);
  });

  it('answers 409 INVALID_STATE_TRANSITION for a DISPOSED unit and writes nothing', async () => {
    repository.findDetail.mockResolvedValue({
      ...detailRow('2.7.19-treklink.3', 5),
      status: DeviceStatus.DISPOSED,
    });
    const [status, body] = await codeOf(
      service.updateFirmware('dev-1', { firmwareVersion: 'x', expectedVersion: 5 }, tx),
    );
    expect(status).toBe(HttpStatus.CONFLICT);
    expect(body).toContain(ErrorCode.INVALID_STATE_TRANSITION);
    expect(repository.setFirmwareIfCurrent).not.toHaveBeenCalled();
  });

  it('accepts a firmware edit on a RETIRED unit before its disposal', async () => {
    repository.findDetail.mockResolvedValue({
      ...detailRow('2.7.19-treklink.3', 5),
      status: DeviceStatus.RETIRED,
    });
    await service.updateFirmware('dev-1', { firmwareVersion: 'y', expectedVersion: 5 }, tx);
    expect(repository.setFirmwareIfCurrent).toHaveBeenCalledWith('dev-1', 5, 'y', tx);
  });

  it('answers 409 STALE_VERSION when the loaded version differs, before writing', async () => {
    repository.findDetail.mockResolvedValue(detailRow('2.7.19-treklink.3', 6));
    const [status, body] = await codeOf(
      service.updateFirmware('dev-1', { firmwareVersion: 'x', expectedVersion: 5 }, tx),
    );
    expect(status).toBe(HttpStatus.CONFLICT);
    expect(body).toContain(ErrorCode.STALE_VERSION);
    expect(repository.setFirmwareIfCurrent).not.toHaveBeenCalled();
  });

  it('answers 409 STALE_VERSION when a concurrent write wins the compare-and-set', async () => {
    repository.findDetail.mockResolvedValue(detailRow('2.7.19-treklink.3', 5));
    repository.setFirmwareIfCurrent.mockResolvedValue(false);
    const [status, body] = await codeOf(
      service.updateFirmware('dev-1', { firmwareVersion: 'x', expectedVersion: 5 }, tx),
    );
    expect(status).toBe(HttpStatus.CONFLICT);
    expect(body).toContain(ErrorCode.STALE_VERSION);
  });
});
