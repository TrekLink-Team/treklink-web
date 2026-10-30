import { subject } from '@casl/ability';
import { HttpStatus, Injectable } from '@nestjs/common';
import { Caller, type PolicyAbility } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { DevicesService } from '../devices';
import {
  FieldEventQueryService,
  HISTORY_KINDS,
  type HistoryKind,
  type HistoryPoint,
} from '../gateway-sync';
import { ParameterService } from '../platform/parameters/parameter.service';
import { ContractsService, type RentalPeriod } from '../rentals';

const DAY_MS = 86_400_000;

// An organization id no row carries. Only the unconditioned `telemetryHistory.read` rule (TrekLink
// Staff and Admin) matches it; `telemetryHistory.read.own` matches the caller's own organization only.
const ANY_ORGANIZATION = '*any organization*';

const forbidden = () =>
  new DomainException(HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN, 'You do not have access to this.');

// Another organization's device and an unknown one read the same, so the answer reveals neither
// (REQ-ERR-01).
const notFound = () =>
  new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Device not found.');

export interface HistoryQuery {
  from: Date;
  to: Date;
  kind?: HistoryKind[];
}

export interface HistoryPointDto {
  at: string;
  kind: HistoryKind;
  lat: number | null;
  lon: number | null;
  altitude: number | null;
  batteryPct: number | null;
}

// The body of GET /api/telemetry/devices/:id/history (api-design 03). `clippedTo` lists the periods the
// caller's organization held the device that overlap the range, whole and not cut to the range, so a
// screen can say when it was rented even if the range misses it; Staff and Admin get none. `truncated`
// is true when the range holds more than HISTORY_MAX_POINTS points and only the oldest are answered.
export interface HistoryDto {
  deviceId: string;
  clippedTo: { from: string; to: string | null }[];
  points: HistoryPointDto[];
  truncated: boolean;
}

const CSV_HEADER = 'at,kind,lat,lon,altitude,batteryPct';
// The last row of a CSV whose range held more than HISTORY_MAX_POINTS points (api-design 03).
const CSV_TRUNCATED = '# truncated';

const overlaps = (period: RentalPeriod, from: Date, to: Date) =>
  period.from < to && (period.to === null || period.to > from);

const toDto = (point: HistoryPoint): HistoryPointDto => ({ ...point, at: point.at.toISOString() });

// The device position and telemetry history (task 3.3, api-design 03, UC-40): the events attributed to
// the caller's organization, or the whole ledger for TrekLink Staff and Admin (REQ-EVT-06). The window is
// at most `monitoring.historyMaxRangeDays` days (REQ-ERR-02).
@Injectable()
export class HistoryService {
  constructor(
    private readonly contracts: ContractsService,
    private readonly devices: DevicesService,
    private readonly events: FieldEventQueryService,
    private readonly parameters: ParameterService,
  ) {}

  async history(
    deviceId: string,
    query: HistoryQuery,
    caller: Caller,
    ability: PolicyAbility,
  ): Promise<HistoryDto> {
    const organizationId = this.scopeOf(caller, ability);
    await this.checkRange(query);

    let clippedTo: HistoryDto['clippedTo'] = [];
    if (organizationId === null) {
      if (!(await this.devices.assetTags([deviceId])).has(deviceId)) throw notFound();
    } else {
      const periods = await this.contracts.rentalPeriods(deviceId, organizationId);
      if (periods.length === 0) throw notFound();
      clippedTo = periods
        .filter((period) => overlaps(period, query.from, query.to))
        .map((period) => ({
          from: period.from.toISOString(),
          to: period.to?.toISOString() ?? null,
        }));
    }

    const { points, truncated } = await this.events.historyPoints({
      deviceId,
      organizationId,
      from: query.from,
      to: query.to,
      kinds: query.kind?.length ? query.kind : HISTORY_KINDS,
    });
    return { deviceId, clippedTo, points: points.map(toDto), truncated };
  }

  // `format=csv`: the points as CSV text, which the envelope carries in `result` (api-design 08 does the
  // same for the reports). An empty cell is a value the device did not send. A truncated range ends with
  // a `# truncated` comment row, so a saved file still says it is incomplete.
  csv(history: HistoryDto): string {
    const rows = history.points.map((point) =>
      [point.at, point.kind, point.lat, point.lon, point.altitude, point.batteryPct]
        .map((value) => value ?? '')
        .join(','),
    );
    return [CSV_HEADER, ...rows, ...(history.truncated ? [CSV_TRUNCATED] : [])].join('\n');
  }

  // The organization the history covers, null for the whole fleet.
  private scopeOf(caller: Caller, ability: PolicyAbility): string | null {
    if (ability.can('read', subject('TelemetryHistory', { organizationId: ANY_ORGANIZATION })))
      return null;
    const own = caller.organizationId;
    if (own === null || !ability.can('read', subject('TelemetryHistory', { organizationId: own })))
      throw forbidden();
    return own;
  }

  // `to` is after `from` and at most `monitoring.historyMaxRangeDays` days later (REQ-ERR-02).
  private async checkRange(query: HistoryQuery): Promise<void> {
    const maxDays = await this.parameters.get('monitoring.historyMaxRangeDays');
    if (typeof maxDays !== 'number' || !Number.isFinite(maxDays)) {
      throw new DomainException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        ErrorCode.INTERNAL_ERROR,
        'The parameter monitoring.historyMaxRangeDays is not a number.',
      );
    }
    const span = query.to.getTime() - query.from.getTime();
    if (span <= 0 || span > maxDays * DAY_MS) {
      throw new DomainException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        `to must be after from and at most ${maxDays} days later.`,
      );
    }
  }
}
