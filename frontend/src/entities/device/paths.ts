// The device home of the caller's area: `/t/devices/:id` for TrekLink, the history of the unit for an
// organization, which has no device home (specs/devices/design.md section 10).
export const deviceHomePath = (scope: 't' | 'o', deviceId: string): string =>
  scope === 't' ? `/t/devices/${deviceId}` : `/o/devices/${deviceId}/telemetry`;
