import { StaleSubject } from '@prisma/client';
import type { DevicesService } from '../../devices';
import type { IncidentsService } from '../../incidents';
import type { OrganizationsService } from '../../organizations';
import type { TransactionalEvents } from '../../platform/events/emit-after-commit';
import type { ParameterService } from '../../platform/parameters/parameter.service';
import type { ContractsService } from '../../rentals';
import { DEVICE_STALE_CHANGED, STATION_STALE_CHANGED } from '../stale-events';
import type { StaleMarkRow, StaleMarksRepository } from '../stale-marks.repository';
import { StaleSweepJob, SWEEP_TICK_TOLERANCE_MS } from './stale-sweep.job';

const NOW = new Date('2026-11-01T03:00:00.000Z');
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000);
const ORG_A = 'org-a';
const ORG_B = 'org-b';
const TX = { tx: true };

// An in-memory `stale_marks`, so a sequence of sweeps can be followed like the table.
class FakeMarks {
  rows = new Map<string, StaleMarkRow>();
  failNext = false;
  key = (type: StaleSubject, id: string) => `${type}:${id}`;
  list = jest.fn((type: StaleSubject) =>
    Promise.resolve([...this.rows.values()].filter((row) => row.subjectType === type)),
  );
  mark = jest.fn((row: StaleMarkRow) => {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error('db down'));
    }
    const key = this.key(row.subjectType, row.subjectId);
    if (this.rows.has(key)) return Promise.resolve(false);
    this.rows.set(key, row);
    return Promise.resolve(true);
  });
  clear = jest.fn(
    (type: StaleSubject, id: string, _tx?: unknown, organizationId?: string | null) => {
      const row = this.rows.get(this.key(type, id));
      if (!row || (organizationId !== undefined && row.organizationId !== organizationId))
        return Promise.resolve(false);
      this.rows.delete(this.key(type, id));
      return Promise.resolve(true);
    },
  );
}

describe('StaleSweepJob', () => {
  let marks: FakeMarks;
  let visible: { deviceId: string; organizationId: string }[];
  let projections: { id: string; lastSeenAt: Date | null }[];
  let stations: { id: string; organizationId: string; name: string; lastSyncAt: Date | null }[];
  let params: Record<string, unknown>;
  let emitted: { name: string; payload: unknown }[];
  let committed: boolean;
  let devices: { projections: jest.Mock };
  let incidents: { markDeviceStale: jest.Mock };
  let job: StaleSweepJob;

  beforeEach(() => {
    marks = new FakeMarks();
    visible = [];
    projections = [];
    stations = [];
    params = {
      'monitoring.staleSweepSeconds': 15,
      'monitoring.deviceStaleSeconds': 300,
      'monitoring.fieldStationStaleSeconds': 180,
    };
    emitted = [];
    committed = true;
    devices = {
      projections: jest.fn((ids: string[]) =>
        Promise.resolve(projections.filter((row) => ids.includes(row.id))),
      ),
    };
    incidents = { markDeviceStale: jest.fn().mockResolvedValue(null) };
    // Events queued inside a transaction go out only when it commits, as TransactionalEvents does.
    let pending: { name: string; payload: unknown }[] | null = null;
    const events = {
      transaction: jest.fn(async (work: (tx: unknown) => Promise<unknown>) => {
        pending = [];
        try {
          const result = await work(TX);
          if (!committed) throw new Error('rolled back');
          emitted.push(...pending);
          return result;
        } finally {
          pending = null;
        }
      }),
      emitAfterCommit: jest.fn((name: string, payload: unknown) => {
        if (pending) pending.push({ name, payload });
        else emitted.push({ name, payload });
      }),
    };
    job = new StaleSweepJob(
      marks as unknown as StaleMarksRepository,
      {
        visibleDevices: jest.fn(() => Promise.resolve(visible)),
      } as unknown as ContractsService,
      devices as unknown as DevicesService,
      {
        fieldStationHealth: jest.fn(() => Promise.resolve(stations)),
      } as unknown as OrganizationsService,
      incidents as unknown as IncidentsService,
      {
        get: jest.fn((key: string) => Promise.resolve(params[key])),
      } as unknown as ParameterService,
      events as unknown as TransactionalEvents,
    );
  });

  const rent = (deviceId: string, organizationId: string, lastSeenAt: Date | null) => {
    visible = [...visible.filter((row) => row.deviceId !== deviceId), { deviceId, organizationId }];
    projections = [
      ...projections.filter((row) => row.id !== deviceId),
      { id: deviceId, lastSeenAt },
    ];
  };
  const deviceEvents = () => emitted.filter((event) => event.name === DEVICE_STALE_CHANGED);
  const stationEvents = () => emitted.filter((event) => event.name === STATION_STALE_CHANGED);

  describe('devices (AC-03)', () => {
    it('reports a device silent past the threshold once, with its last-seen time', async () => {
      rent('d1', ORG_A, ago(301));
      await expect(job.sweep(NOW)).resolves.toEqual({ stale: 1, recovered: 0 });
      expect(deviceEvents()).toEqual([
        {
          name: DEVICE_STALE_CHANGED,
          payload: {
            deviceId: 'd1',
            organizationId: ORG_A,
            stale: true,
            lastSeenAt: ago(301).toISOString(),
          },
        },
      ]);
      expect(marks.mark).toHaveBeenCalledWith(
        {
          subjectType: StaleSubject.DEVICE,
          subjectId: 'd1',
          organizationId: ORG_A,
          lastSeenAt: ago(301),
          markedAt: NOW,
        },
        TX,
      );
    });

    it('repeats nothing while the device stays silent', async () => {
      rent('d1', ORG_A, ago(301));
      await job.sweep(NOW);
      await expect(job.sweep(new Date(NOW.getTime() + 15_000))).resolves.toEqual({
        stale: 0,
        recovered: 0,
      });
      expect(deviceEvents()).toHaveLength(1);
    });

    it('leaves a device heard within the threshold alone, and one never heard', async () => {
      rent('d1', ORG_A, ago(300));
      rent('d2', ORG_A, null);
      await expect(job.sweep(NOW)).resolves.toEqual({ stale: 0, recovered: 0 });
      expect(emitted).toEqual([]);
    });

    it('emits one recovery when the device is heard again, and nothing more after it', async () => {
      rent('d1', ORG_A, ago(400));
      await job.sweep(NOW);
      rent('d1', ORG_A, ago(2));
      await expect(job.sweep(NOW)).resolves.toEqual({ stale: 0, recovered: 1 });
      await expect(job.sweep(NOW)).resolves.toEqual({ stale: 0, recovered: 0 });
      expect(deviceEvents().map((event) => event.payload)).toEqual([
        { deviceId: 'd1', organizationId: ORG_A, stale: true, lastSeenAt: ago(400).toISOString() },
        { deviceId: 'd1', organizationId: ORG_A, stale: false, lastSeenAt: ago(2).toISOString() },
      ]);
      expect(marks.rows.size).toBe(0);
    });

    it('turns stale again after a recovery, one entry per transition', async () => {
      rent('d1', ORG_A, ago(400));
      await job.sweep(NOW);
      rent('d1', ORG_A, ago(1));
      await job.sweep(NOW);
      rent('d1', ORG_A, ago(301));
      await job.sweep(NOW);
      expect(deviceEvents().map((event) => (event.payload as { stale: boolean }).stale)).toEqual([
        true,
        false,
        true,
      ]);
    });

    it('does not recover a device whose threshold was raised but was not heard again', async () => {
      rent('d1', ORG_A, ago(400));
      await job.sweep(NOW);
      params['monitoring.deviceStaleSeconds'] = 600;
      await expect(job.sweep(NOW)).resolves.toEqual({ stale: 0, recovered: 0 });
      expect(marks.rows.size).toBe(1);
    });

    it('follows an Admin change of the threshold', async () => {
      params['monitoring.deviceStaleSeconds'] = 60;
      rent('d1', ORG_A, ago(61));
      await expect(job.sweep(NOW)).resolves.toEqual({ stale: 1, recovered: 0 });
    });

    it('never marks a device out of custody, and reads no projection when nothing is rented', async () => {
      await expect(job.sweep(NOW)).resolves.toEqual({ stale: 0, recovered: 0 });
      expect(devices.projections).not.toHaveBeenCalled();
    });

    it('recovers a marked device checked in and then heard again on the fleet map only', async () => {
      rent('d1', ORG_A, ago(400));
      await job.sweep(NOW);
      visible = [];
      await expect(job.sweep(NOW)).resolves.toEqual({ stale: 0, recovered: 0 });
      projections = [{ id: 'd1', lastSeenAt: ago(1) }];
      await expect(job.sweep(NOW)).resolves.toEqual({ stale: 0, recovered: 1 });
      expect(deviceEvents()[1].payload).toEqual({
        deviceId: 'd1',
        organizationId: null,
        stale: false,
        lastSeenAt: ago(1).toISOString(),
      });
    });

    it('tells the new holder, and not the previous one, of a device handed over while stale', async () => {
      rent('d1', ORG_A, ago(400));
      await job.sweep(NOW);
      rent('d1', ORG_B, ago(400));
      await expect(job.sweep(NOW)).resolves.toEqual({ stale: 1, recovered: 0 });
      expect(deviceEvents().map((event) => event.payload)).toEqual([
        expect.objectContaining({ organizationId: ORG_A, stale: true }),
        expect.objectContaining({ organizationId: ORG_B, stale: true }),
      ]);
      expect(marks.rows.get('DEVICE:d1')?.organizationId).toBe(ORG_B);
    });

    it('drops the mark of a device reset to never heard, without an entry', async () => {
      rent('d1', ORG_A, ago(400));
      await job.sweep(NOW);
      rent('d1', ORG_A, null);
      await expect(job.sweep(NOW)).resolves.toEqual({ stale: 0, recovered: 0 });
      expect(deviceEvents()).toHaveLength(1);
      expect(marks.rows.size).toBe(0);
    });

    it('drops the mark of a device that no longer exists, without an entry', async () => {
      marks.rows.set('DEVICE:gone', {
        subjectType: StaleSubject.DEVICE,
        subjectId: 'gone',
        organizationId: ORG_A,
        lastSeenAt: ago(900),
        markedAt: ago(600),
      });
      await job.sweep(NOW);
      expect(marks.rows.size).toBe(0);
      expect(emitted).toEqual([]);
    });

    it('emits nothing when another run wrote the mark first', async () => {
      rent('d1', ORG_A, ago(400));
      marks.mark.mockResolvedValueOnce(false);
      await expect(job.sweep(NOW)).resolves.toEqual({ stale: 0, recovered: 0 });
      expect(emitted).toEqual([]);
    });

    it('emits nothing for a rolled-back transition, and retries it on the next run', async () => {
      rent('d1', ORG_A, ago(400));
      committed = false;
      await expect(job.sweep(NOW)).resolves.toEqual({ stale: 0, recovered: 0 });
      expect(emitted).toEqual([]);
      committed = true;
      marks.rows.clear();
      await expect(job.sweep(NOW)).resolves.toEqual({ stale: 1, recovered: 0 });
    });

    it('goes on with the other devices when one fails', async () => {
      rent('d1', ORG_A, ago(400));
      rent('d2', ORG_A, ago(400));
      marks.failNext = true;
      await expect(job.sweep(NOW)).resolves.toEqual({ stale: 1, recovered: 0 });
      await expect(job.sweep(NOW)).resolves.toEqual({ stale: 1, recovered: 0 });
      expect(marks.rows.size).toBe(2);
    });
  });

  describe('incident stale flag (incidents REQ-EVT-12)', () => {
    it('flags the incident in the transaction of the stale transition', async () => {
      rent('d1', ORG_A, ago(400));
      await job.sweep(NOW);
      expect(incidents.markDeviceStale).toHaveBeenCalledWith('d1', true, ago(400), TX);
    });

    it('clears it in the transaction of the recovery', async () => {
      rent('d1', ORG_A, ago(400));
      await job.sweep(NOW);
      rent('d1', ORG_A, ago(2));
      await job.sweep(NOW);
      await job.sweep(NOW);
      expect(incidents.markDeviceStale.mock.calls).toEqual([
        ['d1', true, ago(400), TX],
        ['d1', false, ago(2), TX],
      ]);
    });

    it('flags an incident opened after the mark at the next sweep, without a map entry', async () => {
      // A Field Station relays a queued SOS older than the threshold: the device stays stale.
      rent('d1', ORG_A, ago(400));
      await job.sweep(NOW);
      rent('d1', ORG_A, ago(350));
      await expect(job.sweep(NOW)).resolves.toEqual({ stale: 0, recovered: 0 });
      expect(incidents.markDeviceStale.mock.calls).toEqual([
        ['d1', true, ago(400), TX],
        ['d1', true, ago(350), TX],
      ]);
      expect(deviceEvents()).toHaveLength(1);
      expect(marks.rows.get('DEVICE:d1')?.lastSeenAt).toEqual(ago(400));
    });

    it('asks again on every sweep while the device stays stale, the service ignoring a set flag', async () => {
      rent('d1', ORG_A, ago(400));
      await job.sweep(NOW);
      await job.sweep(NOW);
      await job.sweep(NOW);
      expect(incidents.markDeviceStale).toHaveBeenCalledTimes(3);
      expect(incidents.markDeviceStale).toHaveBeenLastCalledWith('d1', true, ago(400), TX);
      expect(deviceEvents()).toHaveLength(1);
    });

    it('keeps the flag of a device checked in while still stale', async () => {
      rent('d1', ORG_A, ago(400));
      await job.sweep(NOW);
      visible = [];
      await job.sweep(NOW);
      expect(incidents.markDeviceStale).toHaveBeenLastCalledWith('d1', true, ago(400), TX);
      expect(marks.rows.size).toBe(1);
    });

    it('retries the flag of a marked device on the next sweep when it fails', async () => {
      rent('d1', ORG_A, ago(400));
      await job.sweep(NOW);
      incidents.markDeviceStale.mockRejectedValueOnce(new Error('lock timeout'));
      await expect(job.sweep(NOW)).resolves.toEqual({ stale: 0, recovered: 0 });
      await job.sweep(NOW);
      expect(incidents.markDeviceStale).toHaveBeenCalledTimes(3);
      expect(marks.rows.size).toBe(1);
    });

    it('clears it for a device checked in while stale and then heard again', async () => {
      rent('d1', ORG_A, ago(400));
      await job.sweep(NOW);
      visible = [];
      projections = [{ id: 'd1', lastSeenAt: ago(1) }];
      await job.sweep(NOW);
      expect(incidents.markDeviceStale).toHaveBeenLastCalledWith('d1', false, ago(1), TX);
    });

    it('emits no stale entry when the flag fails, so the next run retries it', async () => {
      rent('d1', ORG_A, ago(400));
      incidents.markDeviceStale.mockRejectedValueOnce(new Error('lock timeout'));
      await expect(job.sweep(NOW)).resolves.toEqual({ stale: 0, recovered: 0 });
      expect(emitted).toEqual([]);
    });

    it('leaves incidents alone for a Field Station', async () => {
      stations = [{ id: 's1', organizationId: ORG_A, name: 'Station 1', lastSyncAt: ago(900) }];
      await job.sweep(NOW);
      expect(incidents.markDeviceStale).not.toHaveBeenCalled();
    });
  });

  describe('Field Stations (E04-2)', () => {
    const station = (lastSyncAt: Date | null, id = 's1') => ({
      id,
      organizationId: ORG_A,
      name: 'Station 1',
      lastSyncAt,
    });

    it('reports a station silent past its threshold once, and its recovery once', async () => {
      stations = [station(ago(181))];
      await expect(job.sweep(NOW)).resolves.toEqual({ stale: 1, recovered: 0 });
      await expect(job.sweep(NOW)).resolves.toEqual({ stale: 0, recovered: 0 });
      stations = [station(ago(3))];
      await expect(job.sweep(NOW)).resolves.toEqual({ stale: 0, recovered: 1 });
      await expect(job.sweep(NOW)).resolves.toEqual({ stale: 0, recovered: 0 });
      expect(stationEvents().map((event) => event.payload)).toEqual([
        {
          fieldStationId: 's1',
          organizationId: ORG_A,
          stale: true,
          lastSyncAt: ago(181).toISOString(),
        },
        {
          fieldStationId: 's1',
          organizationId: ORG_A,
          stale: false,
          lastSyncAt: ago(3).toISOString(),
        },
      ]);
    });

    it('never reports a station that has not synced yet, or one within its threshold', async () => {
      stations = [station(null), station(ago(180), 's2')];
      await expect(job.sweep(NOW)).resolves.toEqual({ stale: 0, recovered: 0 });
    });

    it('drops the mark of a revoked station without an entry', async () => {
      stations = [station(ago(181))];
      await job.sweep(NOW);
      stations = [];
      await job.sweep(NOW);
      expect(marks.rows.size).toBe(0);
      expect(stationEvents()).toHaveLength(1);
    });
  });

  describe('cadence', () => {
    it('sweeps at most once per monitoring.staleSweepSeconds', async () => {
      const sweep = jest.spyOn(job, 'sweep');
      await expect(job.tick(NOW)).resolves.toEqual({ stale: 0, recovered: 0 });
      await expect(job.tick(new Date(NOW.getTime() + 5_000))).resolves.toBeNull();
      await expect(job.tick(new Date(NOW.getTime() + 10_000))).resolves.toBeNull();
      // A tick a few milliseconds early still counts as on time.
      await expect(
        job.tick(new Date(NOW.getTime() + 15_000 - SWEEP_TICK_TOLERANCE_MS / 2)),
      ).resolves.toEqual({ stale: 0, recovered: 0 });
      expect(sweep).toHaveBeenCalledTimes(2);
    });

    it('follows an Admin change of the cadence', async () => {
      params['monitoring.staleSweepSeconds'] = 5;
      await job.tick(NOW);
      await expect(job.tick(new Date(NOW.getTime() + 5_000))).resolves.not.toBeNull();
    });

    it('refuses a parameter of the wrong shape, which the job runner logs', async () => {
      params['monitoring.deviceStaleSeconds'] = 'soon';
      await expect(job.sweep(NOW)).rejects.toThrow('monitoring.deviceStaleSeconds');
    });

    it('registers on a 5-second cron under its name', () => {
      const tick = Object.getOwnPropertyDescriptor(StaleSweepJob.prototype, 'tick')
        ?.value as object;
      expect(Reflect.getMetadata('treklink:scheduledJob', tick)).toEqual({
        name: 'monitoring.staleSweep',
        cron: '*/5 * * * * *',
      });
    });
  });
});
