import { IncidentState } from '@prisma/client';

// The words a person reads for an incident state in the device history (monitoring api-design 07),
// the labels the frontend shows in `shared/ui/status.ts`. A `Record`, so a new state does not compile
// until it has a label.
export const INCIDENT_STATE_LABEL: Record<IncidentState, string> = {
  DETECTED: 'Detected',
  NOTIFY_PRIMARY: 'Notifying primary',
  NOTIFY_BACKUP: 'Notifying backup',
  NOTIFY_MANAGER: 'Notifying manager',
  UNROUTED: 'Unrouted',
  ESCALATED: 'Escalated',
  REPORTED: 'Reported to authority',
  ACKNOWLEDGED: 'Acknowledged',
  RESPONDING: 'Responding',
  RESOLVED: 'Resolved',
  FALSE_ALARM: 'False alarm',
  CLOSED: 'Closed',
};
