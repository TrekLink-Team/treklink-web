import { DeviceStatus, Prisma } from '@prisma/client';
import { AUDIT_RECORD } from '../../platform/audit/audit-record.event';
import { TransactionalEvents } from '../../platform/events/emit-after-commit';
import { ParameterService } from '../../platform/parameters/parameter.service';
import { MaintenanceRepository } from '../maintenance.repository';
import { MaintenanceService } from '../maintenance.service';
import { ServiceScanJob } from './service-scan.job';

const AT = new Date('2026-11-15T18:00:00.000Z'); // Monday 01:00 in UTC+7.
const DUE_BEFORE = new Date('2026-11-28T00:00:00.000Z');
const TX = {} as Prisma.TransactionClient;

const candidate = (
  id: string,
  overrides: Partial<{
    assetTag: string;
    status: DeviceStatus;
    serviceDueAt: Date | null;
    firmwareVersion: string;
    firmwareBaseline: string;
  }> = {},
) => ({
  id,
  assetTag: overrides.assetTag ?? `TL-${id}`,
  status: overrides.status ?? DeviceStatus.AVAILABLE,
  serviceDueAt:
    overrides.serviceDueAt === undefined
      ? new Date('2026-11-24T00:00:00.000Z')
      : overrides.serviceDueAt,
  firmwareVersion: overrides.firmwareVersion ?? 'current',
  firmwareBaseline: overrides.firmwareBaseline ?? 'current',
});

describe('ServiceScanJob (devices.serviceScan, REQ-EVT-19)', () => {
  let records: { dueDevices: jest.Mock };
  let maintenance: { openScheduled: jest.Mock };
  let parameters: { get: jest.Mock };
  let events: { transaction: jest.Mock; emitAfterCommit: jest.Mock };
  let staff: {
    send: jest.Mock<Promise<{ accepted: number; failed: number }>, [string, string]>;
  };
  let phases: string[];
  let job: ServiceScanJob;

  beforeEach(() => {
    records = { dueDevices: jest.fn().mockResolvedValue([]) };
    maintenance = {
      openScheduled: jest.fn().mockImplementation((id: string) =>
        Promise.resolve({
          id: `m-${id}`,
          reason: 'SCHEDULED',
          expectedAt: new Date('2026-11-24T00:00:00.000Z'),
        }),
      ),
    };
    parameters = {
      get: jest.fn((key: string) =>
        Promise.resolve(key === 'devices.serviceScanHourLocal' ? 1 : 5),
      ),
    };
    phases = [];
    events = {
      transaction: jest.fn(async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
        const result = await work(TX);
        phases.push('commit');
        return result;
      }),
      emitAfterCommit: jest.fn(),
    };
    staff = {
      send: jest.fn<Promise<{ accepted: number; failed: number }>, [string, string]>(() => {
        phases.push('mail');
        return Promise.resolve({ accepted: 2, failed: 0 });
      }),
    };
    job = new ServiceScanJob(
      records as unknown as MaintenanceRepository,
      maintenance as unknown as MaintenanceService,
      parameters as unknown as ParameterService,
      events as unknown as TransactionalEvents,
      staff,
    );
  });

  it('opens one SCHEDULED record for a due AVAILABLE device and audits SYSTEM after commit', async () => {
    records.dueDevices.mockResolvedValue([candidate('1')]);

    await expect(job.run(AT)).resolves.toEqual({ moved: 1, listedOnly: 0 });
    expect(records.dueDevices).toHaveBeenCalledWith(DUE_BEFORE);
    expect(maintenance.openScheduled).toHaveBeenCalledWith('1', DUE_BEFORE, AT, TX);
    expect(events.emitAfterCommit).toHaveBeenCalledWith(
      AUDIT_RECORD,
      expect.objectContaining({
        actorId: null,
        actorRoles: [],
        action: 'maintenance.open',
        subjectId: 'm-1',
      }),
    );
  });

  it('opens FIRMWARE_UPDATE when only the firmware differs', async () => {
    records.dueDevices.mockResolvedValue([
      candidate('2', {
        serviceDueAt: null,
        firmwareVersion: 'old',
        firmwareBaseline: 'current',
      }),
    ]);
    maintenance.openScheduled.mockResolvedValue({
      id: 'm-2',
      reason: 'FIRMWARE_UPDATE',
      expectedAt: new Date('2026-11-16T00:00:00.000Z'),
    });

    await job.run(AT);
    expect(staff.send).toHaveBeenCalledWith(
      'TrekLink weekly device service scan',
      expect.stringContaining('FIRMWARE_UPDATE, expected 2026-11-16'),
    );
  });

  it('lists an AVAILABLE device with an open record without opening another', async () => {
    records.dueDevices.mockResolvedValue([candidate('open')]);
    maintenance.openScheduled.mockResolvedValue(null);

    await expect(job.run(AT)).resolves.toEqual({ moved: 0, listedOnly: 1 });
    expect(staff.send).toHaveBeenCalledWith(
      'TrekLink weekly device service scan',
      expect.stringContaining('TL-open (AVAILABLE)'),
    );
  });

  it('lists RESERVED and RENTED devices without moving them', async () => {
    records.dueDevices.mockResolvedValue([
      candidate('reserved', { status: DeviceStatus.RESERVED }),
      candidate('rented', { status: DeviceStatus.RENTED }),
    ]);

    await expect(job.run(AT)).resolves.toEqual({ moved: 0, listedOnly: 2 });
    expect(maintenance.openScheduled).not.toHaveBeenCalled();
    expect(staff.send.mock.calls[0][1]).toEqual(expect.stringContaining('TL-reserved (RESERVED)'));
    expect(staff.send.mock.calls[0][1]).toEqual(expect.stringContaining('TL-rented (RENTED)'));
  });

  it('opens nothing on a second run in the same week', async () => {
    records.dueDevices.mockResolvedValue([candidate('1')]);
    maintenance.openScheduled
      .mockResolvedValueOnce({
        id: 'm-1',
        reason: 'SCHEDULED',
        expectedAt: new Date('2026-11-24T00:00:00.000Z'),
      })
      .mockResolvedValueOnce(null);

    await expect(job.run(AT)).resolves.toEqual({ moved: 1, listedOnly: 0 });
    await expect(job.run(AT)).resolves.toEqual({ moved: 0, listedOnly: 1 });
    expect(events.emitAfterCommit).toHaveBeenCalledTimes(1);
  });

  it('emails both groups after every per-device transaction commits', async () => {
    records.dueDevices.mockResolvedValue([
      candidate('available'),
      candidate('rented', { status: DeviceStatus.RENTED }),
    ]);

    await job.run(AT);
    expect(phases).toEqual(['commit', 'mail']);
    expect(staff.send).toHaveBeenCalledWith(
      'TrekLink weekly device service scan',
      expect.stringMatching(
        /Moved to MAINTENANCE:[\s\S]*TL-available[\s\S]*Listed only:[\s\S]*TL-rented/,
      ),
    );
  });

  it('does nothing outside Monday at the configured local hour', async () => {
    await expect(job.run(new Date('2026-11-16T18:00:00.000Z'))).resolves.toEqual({
      moved: 0,
      listedOnly: 0,
    });
    expect(records.dueDevices).not.toHaveBeenCalled();
    expect(parameters.get).toHaveBeenCalledWith('devices.serviceScanHourLocal');
  });
});
