// Emitted after commit by IncidentLifecycle when a transition queued alert rows. It wakes the
// dispatcher, so an alert does not wait for the next cron tick (NFR-PERF-04).
export const INCIDENT_ALERTS_QUEUED = 'incident.alertsQueued';

export interface IncidentAlertsQueuedEvent {
  incidentId: string;
}
