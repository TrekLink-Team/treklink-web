import { Injectable, Logger } from '@nestjs/common';
import { StaleSubject } from '@prisma/client';
import { DevicesService } from '../../devices';
import { IncidentsService } from '../../incidents';
import { OrganizationsService } from '../../organizations';
import { TransactionalEvents } from '../../platform/events/emit-after-commit';
import { ParameterService } from '../../platform/parameters/parameter.service';
import { ScheduledJob } from '../../platform/scheduler/scheduled-job.decorator';
import { ContractsService } from '../../rentals';
import {
  DEVICE_STALE_CHANGED,
  STATION_STALE_CHANGED,
  type DeviceStaleChangedEvent,
  type StationStaleChangedEvent,
} from '../stale-events';
import { StaleMarkRow, StaleMarksRepository } from '../stale-marks.repository';

// The cron ticks every 5 s, the lower bound of `monitoring.staleSweepSeconds`; a tick that comes
// earlier than the parameter asks is skipped. The tolerance keeps a tick a few milliseconds early from
// being skipped, which would stretch a 15 s cadence to 20 s.
export const SWEEP_TICK_TOLERANCE_MS = 1000;

export interface SweepResult {
  stale: number;
  recovered: number;
}

type Change = 'stale' | 'recovered';

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

// monitoring.staleSweep (task 2.4, design §3, REQ-EVT-03): every `monitoring.staleSweepSeconds`, a
// rented device silent longer than `monitoring.deviceStaleSeconds` and a Field Station silent longer
// than `monitoring.fieldStationStaleSeconds` turn stale, and one heard again recovers. Only transitions
// are reported: each is stored in `stale_marks`, together with the incident flag of the device
// (`IncidentsService.markDeviceStale`, REQ-EVT-12), and its event is emitted after that commit, so the
// unchanged state repeats nothing, also after a restart. A marked device still stale asks the incident
// flag again on every run, which flags an incident opened after the mark and is otherwise a no-op. JobRunnerService runs the job under an advisory
// lock, so one sweep runs at a time across replicas; the insert and the delete of a mark are guarded
// as well. One subject that fails is logged and retried on the next run; the others go on.
//
// The rule for a device matches the snapshot read (LiveMapService): stale once `lastSeenAt` is older
// than the threshold, never stale before it was first heard. Only devices in custody turn stale, as the
// map lists only them. A device handed to another organization while stale is reconsidered for the new
// one, and the old one hears nothing more (REQ-EVT-04). A marked device checked in and later heard
// again recovers on the fleet map only.
@Injectable()
export class StaleSweepJob {
  private readonly logger = new Logger(StaleSweepJob.name);
  private lastSweepAt: number | null = null;

  constructor(
    private readonly marks: StaleMarksRepository,
    private readonly contracts: ContractsService,
    private readonly devices: DevicesService,
    private readonly organizations: OrganizationsService,
    private readonly incidents: IncidentsService,
    private readonly parameters: ParameterService,
    private readonly events: TransactionalEvents,
  ) {}

  @ScheduledJob('monitoring.staleSweep', '*/5 * * * * *')
  async tick(at: Date = new Date()): Promise<SweepResult | null> {
    const seconds = await this.parameters.get('monitoring.staleSweepSeconds');
    if (!isNumber(seconds)) throw new Error('monitoring.staleSweepSeconds is not a number');
    if (
      this.lastSweepAt !== null &&
      at.getTime() - this.lastSweepAt + SWEEP_TICK_TOLERANCE_MS < seconds * 1000
    )
      return null;
    this.lastSweepAt = at.getTime();
    return this.sweep(at);
  }

  async sweep(at: Date = new Date()): Promise<SweepResult> {
    const result: SweepResult = { stale: 0, recovered: 0 };
    const count = (change: Change | null) => {
      if (change) result[change] += 1;
    };
    for (const change of await this.sweepDevices(at)) count(change);
    for (const change of await this.sweepStations(at)) count(change);
    if (result.stale + result.recovered > 0)
      this.logger.log(`Stale sweep: ${result.stale} stale, ${result.recovered} recovered`);
    return result;
  }

  private async sweepDevices(at: Date): Promise<(Change | null)[]> {
    const threshold = await this.threshold('monitoring.deviceStaleSeconds');
    const [visible, marks] = await Promise.all([
      this.contracts.visibleDevices({ organizationId: null }),
      this.marks.list(StaleSubject.DEVICE),
    ]);
    const holder = new Map(visible.map((device) => [device.deviceId, device.organizationId]));
    const markOf = new Map(marks.map((mark) => [mark.subjectId, mark]));
    const ids = [...new Set([...holder.keys(), ...markOf.keys()])];
    const projections = ids.length > 0 ? await this.devices.projections(ids) : [];
    const staleBefore = at.getTime() - threshold * 1000;
    const changes: (Change | null)[] = [];
    const seen = new Set<string>();
    for (const device of projections) {
      seen.add(device.id);
      changes.push(
        await this.guard(StaleSubject.DEVICE, device.id, () =>
          this.device(
            device.id,
            holder.get(device.id),
            device.lastSeenAt,
            markOf.get(device.id),
            staleBefore,
            at,
          ),
        ),
      );
    }
    // A mark whose device no longer exists has nobody to tell.
    for (const mark of marks)
      if (!seen.has(mark.subjectId))
        await this.guard(StaleSubject.DEVICE, mark.subjectId, () => this.releaseDevice(mark, null));
    return changes;
  }

  // `organizationId` undefined: the device is in nobody's custody now.
  private async device(
    deviceId: string,
    organizationId: string | undefined,
    lastSeenAt: Date | null,
    mark: StaleMarkRow | undefined,
    staleBefore: number,
    at: Date,
  ): Promise<Change | null> {
    if (lastSeenAt === null) {
      // Never heard, or reset: never stale, and a mark has no later reading to recover with. The
      // incident flag goes with the mark.
      return mark ? this.releaseDevice(mark, null) : null;
    }
    const stale = lastSeenAt.getTime() < staleBefore;
    if (mark && organizationId !== undefined && mark.organizationId !== organizationId) {
      // Handed to another organization while stale: the previous one hears nothing more. A device
      // still silent keeps its incident flag and is marked again below for the new holder; one heard
      // since loses the flag with the mark.
      if (stale) await this.drop(StaleSubject.DEVICE, mark);
      else await this.releaseDevice(mark, lastSeenAt);
      mark = undefined;
    }
    if (mark) {
      if (stale) return this.keepFlag(deviceId, lastSeenAt);
      const heardAgain = lastSeenAt.getTime() > mark.lastSeenAt.getTime();
      if (!heardAgain) return null;
      return this.recoverDevice(deviceId, organizationId ?? null, mark, lastSeenAt);
    }
    if (!stale || organizationId === undefined) return null;
    return this.markDevice(deviceId, organizationId, lastSeenAt, at);
  }

  private markDevice(
    deviceId: string,
    organizationId: string,
    lastSeenAt: Date,
    at: Date,
  ): Promise<Change | null> {
    return this.events.transaction(async (tx) => {
      const row = {
        subjectType: StaleSubject.DEVICE,
        subjectId: deviceId,
        organizationId,
        lastSeenAt,
        markedAt: at,
      };
      if (!(await this.marks.mark(row, tx))) return null;
      // The device's incident outside CLOSED is flagged in the same transaction (REQ-EVT-12).
      await this.incidents.markDeviceStale(deviceId, true, lastSeenAt, tx);
      this.events.emitAfterCommit(DEVICE_STALE_CHANGED, {
        deviceId,
        organizationId,
        stale: true,
        lastSeenAt: lastSeenAt.toISOString(),
      } satisfies DeviceStaleChangedEvent);
      return 'stale';
    });
  }

  // A device marked and still silent: an incident opened since the mark is flagged too (REQ-EVT-12).
  // A Field Station relays a queued SOS with its occurrence time as `lastSeenAt`, so the incident can
  // open after the device was already marked stale. `markDeviceStale` changes nothing when the flag is
  // already set, or when the device has no incident outside CLOSED. Not a transition: no event.
  private async keepFlag(deviceId: string, lastSeenAt: Date): Promise<null> {
    await this.events.transaction((tx) =>
      this.incidents.markDeviceStale(deviceId, true, lastSeenAt, tx),
    );
    return null;
  }

  private recoverDevice(
    deviceId: string,
    organizationId: string | null,
    mark: StaleMarkRow,
    lastSeenAt: Date,
  ): Promise<Change | null> {
    return this.events.transaction(async (tx) => {
      if (!(await this.marks.clear(StaleSubject.DEVICE, deviceId, tx, mark.organizationId)))
        return null;
      await this.incidents.markDeviceStale(deviceId, false, lastSeenAt, tx);
      this.events.emitAfterCommit(DEVICE_STALE_CHANGED, {
        deviceId,
        organizationId,
        stale: false,
        lastSeenAt: lastSeenAt.toISOString(),
      } satisfies DeviceStaleChangedEvent);
      return 'recovered';
    });
  }

  private async sweepStations(at: Date): Promise<(Change | null)[]> {
    const threshold = await this.threshold('monitoring.fieldStationStaleSeconds');
    const [stations, marks] = await Promise.all([
      this.organizations.fieldStationHealth(null),
      this.marks.list(StaleSubject.FIELD_STATION),
    ]);
    const markOf = new Map(marks.map((mark) => [mark.subjectId, mark]));
    const staleBefore = at.getTime() - threshold * 1000;
    const changes: (Change | null)[] = [];
    for (const station of stations) {
      const mark = markOf.get(station.id);
      markOf.delete(station.id);
      changes.push(
        await this.guard(StaleSubject.FIELD_STATION, station.id, () => {
          const { lastSyncAt } = station;
          // A station that never synced is not stale, it has no sync yet (snapshot rule).
          if (lastSyncAt === null) return Promise.resolve(null);
          const stale = lastSyncAt.getTime() < staleBefore;
          if (mark) {
            if (stale || lastSyncAt.getTime() <= mark.lastSeenAt.getTime())
              return Promise.resolve(null);
            return this.station(station.id, station.organizationId, false, lastSyncAt, at);
          }
          if (!stale) return Promise.resolve(null);
          return this.station(station.id, station.organizationId, true, lastSyncAt, at);
        }),
      );
    }
    // Revoked stations are not listed any more; their marks go without an entry.
    for (const mark of markOf.values())
      await this.guard(StaleSubject.FIELD_STATION, mark.subjectId, () =>
        this.drop(StaleSubject.FIELD_STATION, mark),
      );
    return changes;
  }

  private station(
    fieldStationId: string,
    organizationId: string,
    stale: boolean,
    lastSyncAt: Date,
    at: Date,
  ): Promise<Change | null> {
    return this.events.transaction(async (tx) => {
      const written = stale
        ? await this.marks.mark(
            {
              subjectType: StaleSubject.FIELD_STATION,
              subjectId: fieldStationId,
              organizationId,
              lastSeenAt: lastSyncAt,
              markedAt: at,
            },
            tx,
          )
        : await this.marks.clear(StaleSubject.FIELD_STATION, fieldStationId, tx);
      if (!written) return null;
      this.events.emitAfterCommit(STATION_STALE_CHANGED, {
        fieldStationId,
        organizationId,
        stale,
        lastSyncAt: lastSyncAt.toISOString(),
      } satisfies StationStaleChangedEvent);
      return stale ? 'stale' : 'recovered';
    });
  }

  // Removes a device mark without an entry, like `drop`, and clears the incident flag in the same
  // transaction (REQ-EVT-12), so "Device silent" does not outlive the mark. Only the run that deletes
  // the mark clears the flag.
  private releaseDevice(mark: StaleMarkRow, lastSeenAt: Date | null): Promise<null> {
    return this.events.transaction(async (tx) => {
      if (await this.marks.clear(StaleSubject.DEVICE, mark.subjectId, tx, mark.organizationId))
        await this.incidents.markDeviceStale(mark.subjectId, false, lastSeenAt, tx);
      return null;
    });
  }

  // Removes a mark without an entry: its subject left the map, so nobody is told.
  private async drop(subjectType: StaleSubject, mark: StaleMarkRow): Promise<null> {
    await this.marks.clear(subjectType, mark.subjectId, undefined, mark.organizationId);
    return null;
  }

  private async guard(
    subjectType: StaleSubject,
    subjectId: string,
    work: () => Promise<Change | null>,
  ): Promise<Change | null> {
    try {
      return await work();
    } catch (error) {
      this.logger.error(
        `Stale sweep of ${subjectType} ${subjectId} failed, retried on the next run: ${
          error instanceof Error ? error.stack : String(error)
        }`,
      );
      return null;
    }
  }

  private async threshold(
    key: 'monitoring.deviceStaleSeconds' | 'monitoring.fieldStationStaleSeconds',
  ): Promise<number> {
    const seconds = await this.parameters.get(key);
    if (!isNumber(seconds)) throw new Error(`${key} is not a number`);
    return seconds;
  }
}
