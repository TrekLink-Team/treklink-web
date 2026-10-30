// Emitted after commit when a Field Station credential is revoked (design §5, platform design §2.3).
// `gateway-sync` drops that username's messages and closes its topic at once.
export const FIELD_STATION_REVOKED = 'fieldStation.revoked';

export interface FieldStationRevokedEvent {
  organizationId: string;
  fieldStationId: string;
  mqttUsername: string;
}
