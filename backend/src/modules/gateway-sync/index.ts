// Public surface of `gateway-sync`. Other modules import only from here.
export { GatewaySyncModule } from './gateway-sync.module';
export {
  FieldEventQueryService,
  HISTORY_KINDS,
  HISTORY_MAX_POINTS,
  type HistoryKind,
  type HistoryPoint,
} from './field-event-query.service';
export { type SimulatedDeviceQuery } from './sync-query.repository';
export { SyncStatsService, type SyncStats } from './sync-stats.service';
export { UplinkIngress, type UplinkOptions, type UplinkOutcome } from './uplink-ingress';
// The field simulation of the demo panel (specs/demo/design.md §9); the demo routes call it.
export {
  FieldSimulationService,
  type SimulatableDeviceView,
  type SimulatedNodeView,
  type SimulationActor,
  type SimulationEventKind,
  type SimulationOverview,
  type StartNodeInput,
  type TrailView,
  type UpdateNodeInput,
} from './simulator/field-simulation.service';
export {
  MAX_SPEED_METRES_PER_MINUTE,
  MIN_SPEED_METRES_PER_MINUTE,
  SIMULATION_PATTERNS,
  type SimulationPatternName,
} from './simulator/field-simulation';
export { SIMULATION_STYLES, type SimulationStyleName } from './simulator/field-styles';
export {
  DEMO_SIMULATION_FLAG,
  FieldSimulatorModule,
  demoSimulationEnabled,
  fieldSimulatorEnabled,
} from './simulator/field-simulator.module';
export {
  FIELD_POSITION,
  FIELD_TELEMETRY,
  type FieldPositionEvent,
  type FieldTelemetryEvent,
} from './field-events';
