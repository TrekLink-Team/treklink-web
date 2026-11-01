import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FieldStationsService } from '../organizations';
import { ValidatedEnvironment } from '../platform/config/environment-variables';

export const STATION_HEALTH_SCHEMA = 'treklink.fs_health';
const TIERS = 4;

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;
const isEpochMs = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export interface StationHealthReport {
  version: string;
  depth: number[];
  oldestAttempts: number | null;
  lastFlushAt: number | null;
  sentAt: number;
}

// The Field Station health payload of mqtt-ingress-contract.md ("Field Station health"); null when the
// message does not match it.
export function parseStationHealth(body: Buffer): StationHealthReport | null {
  let message: unknown;
  try {
    message = JSON.parse(body.toString('utf8'));
  } catch {
    return null;
  }
  if (!isObject(message) || message.schema !== STATION_HEALTH_SCHEMA || message.v !== 1)
    return null;
  const { version, depth, oldest_attempts, last_flush_at, sent_at } = message;
  if (typeof version !== 'string' || version === '' || version.length > 64) return null;
  if (!Array.isArray(depth) || depth.length !== TIERS || !depth.every(isCount)) return null;
  if (oldest_attempts !== null && !isCount(oldest_attempts)) return null;
  if (last_flush_at !== null && !isEpochMs(last_flush_at)) return null;
  if (!isEpochMs(sent_at)) return null;
  return {
    version,
    depth: depth,
    oldestAttempts: oldest_attempts,
    lastFlushAt: last_flush_at,
    sentAt: sent_at,
  };
}

// A time on the station clock moved onto the backend clock with the offset of this publish,
// `receivedAt - sent_at` (D-040, the same correction as `fs_captured_at`), never later than receipt.
export const corrected = (stationMs: number, sentAtMs: number, receivedAt: Date): Date =>
  new Date(Math.min(receivedAt.getTime(), receivedAt.getTime() - (sentAtMs - stationMs)));

// Task 2.5, health part (design §2 and §3, FR-EVT-13, FR-EVT-18): a report on
// `<root>/fs/<username>/health` writes the station's health projection through `organizations`. A health
// report is not an ingestion attempt, so it leaves no sync audit row; an unknown or revoked station and a
// payload that does not match the contract are logged and dropped.
@Injectable()
export class StationHealthHandler {
  private readonly logger = new Logger(StationHealthHandler.name);
  private readonly topic: RegExp;
  readonly subscription: string;

  constructor(
    config: ConfigService<ValidatedEnvironment, true>,
    private readonly stations: FieldStationsService,
  ) {
    const root = config.get('MQTT_ROOT', { infer: true });
    this.topic = new RegExp(`^${root}/fs/([^/]+)/health$`);
    this.subscription = `${root}/fs/+/health`;
  }

  matches(topic: string): boolean {
    return this.topic.test(topic);
  }

  // Returns whether the report was recorded.
  async handle(topic: string, body: Buffer, receivedAt: Date): Promise<boolean> {
    const username = this.topic.exec(topic)?.[1];
    if (!username) return false;
    const report = parseStationHealth(body);
    if (!report) {
      this.logger.warn(
        `Health report of ${username} does not match ${STATION_HEALTH_SCHEMA} v1; dropped`,
      );
      return false;
    }
    const station = await this.stations.stationByUsername(username);
    if (!station || station.revokedAt) {
      this.logger.warn(
        `Health report of ${username} dropped: no active Field Station has that username`,
      );
      return false;
    }
    const [p0, p1, p2, p3] = report.depth;
    await this.stations.recordStationHealth(station.id, {
      at: receivedAt,
      queueDepth: [p0, p1, p2, p3],
      // An empty queue has no oldest entry: no retries are pending (organizations StationHealth).
      oldestRetryCount: report.oldestAttempts ?? 0,
      version: report.version,
      lastFlushAt:
        report.lastFlushAt === null
          ? null
          : corrected(report.lastFlushAt, report.sentAt, receivedAt),
    });
    return true;
  }
}
