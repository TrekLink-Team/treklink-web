// Public surface of `gateway-sync`. Other modules import only from here.
export { GatewaySyncModule } from './gateway-sync.module';
export {
  FieldEventQueryService,
  HISTORY_KINDS,
  HISTORY_MAX_POINTS,
  type HistoryKind,
  type HistoryPoint,
} from './field-event-query.service';
export { SyncStatsService, type SyncStats } from './sync-stats.service';
export { UplinkIngress, type UplinkOutcome } from './uplink-ingress';
export { FieldSimulatorModule, fieldSimulatorEnabled } from './simulator/field-simulator.module';
export {
  FIELD_POSITION,
  FIELD_TELEMETRY,
  type FieldPositionEvent,
  type FieldTelemetryEvent,
} from './field-events';
