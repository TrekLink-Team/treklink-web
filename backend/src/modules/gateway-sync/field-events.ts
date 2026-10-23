// Domain events emitted after commit (platform design §2.3); `monitoring` consumes them.
export const FIELD_POSITION = 'field.position';
export const FIELD_TELEMETRY = 'field.telemetry';

// organizationId is null for an UNATTRIBUTED event, which reaches the fleet stream only (BR-36).
export interface FieldPositionEvent {
  deviceId: string;
  organizationId: string | null;
  lat: number;
  lon: number;
  at: string; // occurrence time, ISO 8601 UTC
  plotted: boolean;
}

export interface FieldTelemetryEvent {
  deviceId: string;
  organizationId: string | null;
  batteryPct: number;
  at: string;
}
