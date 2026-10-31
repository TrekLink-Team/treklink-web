import { Inject, Injectable, Optional } from '@nestjs/common';
import { SyncOutcome } from '@prisma/client';
import { FieldStationsService } from '../organizations';
import { ParameterService } from '../platform/parameters/parameter.service';
import { MQTT_HEALTH_PROBE, type MqttHealthProbe } from '../platform/ports';
import { SyncStatusDto } from './dto/gateway-sync-ops.dto';
import { SyncQueryRepository } from './sync-query.repository';

// The look-back when the request names none (api-design 07).
export const DEFAULT_SYNC_WINDOW_MINUTES = 60;

export type BrokerState = 'up' | 'down' | 'unknown';
export type StationConnection = 'CONNECTED' | 'STALE' | 'NEVER_REPORTED';

export interface QueueDepth {
  p0: number;
  p1: number;
  p2: number;
  p3: number;
}

export interface StationStatusView {
  id: string;
  name: string;
  mqttUsername: string;
  organization: { id: string; code: string; name: string };
  connection: StationConnection;
  lastSyncAt: Date | null;
  lastFlushAt: Date | null;
  queueDepth: QueueDepth;
  oldestRetryCount: number | null;
  version: string | null;
}

export interface SyncStatusView {
  broker: { subscriber: BrokerState };
  staleAfterSeconds: number;
  fieldStations: StationStatusView[];
  ingestion: {
    windowMinutes: number;
    accepted: number;
    acceptedUnattributed: number;
    duplicates: number;
    malformed: number;
    normalizationFailed: number;
    unknownDevice: number;
    lastReceivedAt: Date | null;
  };
}

// Index 0 = P0 .. 3 = P3 (organizations design §4); named per priority on the wire (D-057 rule 9).
export const depthOf = (depth: number[]): QueueDepth => ({
  p0: depth[0] ?? 0,
  p1: depth[1] ?? 0,
  p2: depth[2] ?? 0,
  p3: depth[3] ?? 0,
});

// A station is connected while its last health report is younger than
// `monitoring.fieldStationStaleSeconds` (FR-MON-03); it reports every 60 s while its uplink is up.
export const connectionOf = (
  lastSyncAt: Date | null,
  now: Date,
  staleAfterSeconds: number,
): StationConnection => {
  if (!lastSyncAt) return 'NEVER_REPORTED';
  return now.getTime() - lastSyncAt.getTime() > staleAfterSeconds * 1000 ? 'STALE' : 'CONNECTED';
};

// `op syncStatus` (api-design 07): MF-02 end to end for TrekLink Staff. The backend subscriber's broker
// connection, each Field Station's connection, queue depth per priority and last flush, and the
// ingestion outcomes of the window from the sync audit.
@Injectable()
export class SyncStatusService {
  constructor(
    private readonly repository: SyncQueryRepository,
    private readonly stations: FieldStationsService,
    private readonly parameters: ParameterService,
    @Optional() @Inject(MQTT_HEALTH_PROBE) private readonly probe?: MqttHealthProbe | null,
  ) {}

  async status(dto: SyncStatusDto, now = new Date()): Promise<SyncStatusView> {
    const windowMinutes = dto.windowMinutes ?? DEFAULT_SYNC_WINDOW_MINUTES;
    const [staleAfterSeconds, stations, outcomes, lastReceivedAt] = await Promise.all([
      this.parameters.get('monitoring.fieldStationStaleSeconds'),
      this.stations.activeWithHealth(),
      this.repository.outcomesSince(new Date(now.getTime() - windowMinutes * 60_000)),
      this.repository.lastReceivedAt(),
    ]);
    const count = (key: SyncOutcome) => outcomes.get(key) ?? 0;
    return {
      broker: { subscriber: !this.probe ? 'unknown' : this.probe.isConnected() ? 'up' : 'down' },
      staleAfterSeconds,
      fieldStations: stations.map((station) => ({
        id: station.id,
        name: station.name,
        mqttUsername: station.mqttUsername,
        organization: {
          id: station.organization.id,
          code: station.organization.code,
          name: station.organization.legalName,
        },
        connection: connectionOf(station.lastSyncAt, now, staleAfterSeconds),
        lastSyncAt: station.lastSyncAt,
        lastFlushAt: station.lastFlushAt,
        queueDepth: depthOf(station.queueDepth),
        oldestRetryCount: station.oldestRetryCount,
        version: station.version,
      })),
      ingestion: {
        windowMinutes,
        accepted: count(SyncOutcome.ACCEPTED),
        acceptedUnattributed: count(SyncOutcome.ACCEPTED_UNATTRIBUTED),
        duplicates: count(SyncOutcome.DUPLICATE_REJECTED),
        malformed: count(SyncOutcome.MALFORMED_ENVELOPE),
        normalizationFailed: count(SyncOutcome.NORMALIZATION_FAILED),
        unknownDevice: count(SyncOutcome.UNKNOWN_DEVICE),
        lastReceivedAt,
      },
    };
  }
}
