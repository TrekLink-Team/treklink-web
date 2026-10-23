import { EventKind, PriorityTier } from '@prisma/client';
import { NormalizedReading, TypeStrategy } from './normalized-reading';

// TELEMETRY_APP is a protobuf oneof the JSON does not label (FGT §4); device_metrics is recognised by its
// battery_level. Meshtastic reports 101 for external power, which is not a charge level.
export class TelemetryStrategy implements TypeStrategy {
  normalize(payload: Record<string, unknown>): NormalizedReading {
    const level = payload.battery_level;
    const batteryPct =
      typeof level === 'number' && Number.isInteger(level) && level >= 0 && level <= 100
        ? level
        : undefined;
    return {
      kind: EventKind.TELEMETRY,
      priority: PriorityTier.P3_TELEMETRY,
      ...(batteryPct !== undefined ? { batteryPct } : {}),
    };
  }
}
