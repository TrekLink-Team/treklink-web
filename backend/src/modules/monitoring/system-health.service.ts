import { Injectable } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  FieldStationReleaseService,
  FieldStationsService,
  isOutdatedAgainst,
} from '../organizations';
import { SyncStatsService } from '../gateway-sync';
import { IncidentsQueryService } from '../incidents';
import { HealthService, type HealthReport } from '../platform/health/health.service';
import { ParameterService } from '../platform/parameters/parameter.service';

// The look-back when the request names none, and its ceiling: one day, as `op syncStatus` (gateway-sync
// api-design 07).
export const DEFAULT_HEALTH_WINDOW_MINUTES = 60;
export const HEALTH_WINDOW_MAX_MINUTES = 1440;

export class SystemHealthQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(HEALTH_WINDOW_MAX_MINUTES)
  windowMinutes?: number;
}

export interface QueueDepth {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
}

export interface SystemHealthStation {
  id: string;
  name: string;
  organization: { id: string; name: string };
  lastSyncAt: Date | null;
  stale: boolean;
  queueDepth: QueueDepth;
  oldestRetryCount: number | null;
  version: string | null;
  outdated: boolean;
}

export interface SystemHealthView {
  health: { status: HealthReport['status']; components: HealthReport['components'] };
  ingestion: {
    perMinute: number;
    accepted: number;
    duplicates: number;
    malformed: number;
    unknownDevice: number;
  };
  fieldStations: {
    total: number;
    stale: number;
    outdated: number;
    // Null when `release.json` cannot be read: no station is then reported outdated.
    currentRelease: string | null;
    maxQueueDepth: QueueDepth;
    items: SystemHealthStation[];
  };
  devicesBuffering: number;
  alerts: { pending: number; failed: number };
}

// Index 0 = P0 .. 3 = P3 (organizations design §4), named per priority on the wire (D-057 rule 9).
const depthOf = (depth: number[]): QueueDepth => ({
  p0: depth[0] ?? 0,
  p1: depth[1] ?? 0,
  p2: depth[2] ?? 0,
  p3: depth[3] ?? 0,
});

const maxDepth = (depths: QueueDepth[]): QueueDepth => ({
  p0: Math.max(0, ...depths.map((depth) => depth.p0)),
  p1: Math.max(0, ...depths.map((depth) => depth.p1)),
  p2: Math.max(0, ...depths.map((depth) => depth.p2)),
  p3: Math.max(0, ...depths.map((depth) => depth.p3)),
});

// `GET /api/system-health` (api-design 06, UC-42, FR-MON-10, FR-EVT-13): the platform health, the
// ingestion of the window, every Field Station that is not revoked, the devices buffering and the alert
// outbox, composed from `platform`, `gateway-sync`, `organizations` and `incidents`.
@Injectable()
export class SystemHealthService {
  constructor(
    private readonly health: HealthService,
    private readonly sync: SyncStatsService,
    private readonly stations: FieldStationsService,
    private readonly release: FieldStationReleaseService,
    private readonly incidents: IncidentsQueryService,
    private readonly parameters: ParameterService,
  ) {}

  async report(query: SystemHealthQueryDto, now = new Date()): Promise<SystemHealthView> {
    const windowMinutes = query.windowMinutes ?? DEFAULT_HEALTH_WINDOW_MINUTES;
    // A database that cannot be reached answers 503 from the health check, and every other read here needs
    // it too, so the report fails whole instead of half.
    const [health, stats, rows, release, alerts, staleAfterSeconds] = await Promise.all([
      this.health.check(),
      this.sync.stats(windowMinutes, now),
      this.stations.activeWithHealth(),
      this.release.currentOrNull(),
      this.incidents.alertDeliveryStats(),
      this.parameters.get('monitoring.fieldStationStaleSeconds'),
    ]);

    const items = rows.map<SystemHealthStation>((row) => ({
      id: row.id,
      name: row.name,
      organization: { id: row.organization.id, name: row.organization.legalName },
      lastSyncAt: row.lastSyncAt,
      // A station that never reported counts as stale: nothing says it is connected.
      stale:
        row.lastSyncAt === null ||
        now.getTime() - row.lastSyncAt.getTime() > staleAfterSeconds * 1000,
      queueDepth: depthOf(row.queueDepth),
      oldestRetryCount: row.oldestRetryCount,
      version: row.version,
      outdated: isOutdatedAgainst(row.version, release?.version ?? null),
    }));

    return {
      health: { status: health.status, components: health.components },
      ingestion: {
        perMinute: Math.round((stats.accepted / windowMinutes) * 10) / 10,
        accepted: stats.accepted,
        duplicates: stats.duplicates,
        malformed: stats.malformed,
        unknownDevice: stats.unknownDevice,
      },
      fieldStations: {
        total: items.length,
        stale: items.filter((item) => item.stale).length,
        outdated: items.filter((item) => item.outdated).length,
        currentRelease: release?.version ?? null,
        maxQueueDepth: maxDepth(items.map((item) => item.queueDepth)),
        items,
      },
      devicesBuffering: stats.devicesBuffering,
      alerts,
    };
  }
}
