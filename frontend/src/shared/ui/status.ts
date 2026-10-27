// TrekLink System Colors: one tone per group of states, one palette per lifecycle (convention 06
// §8.3, decisions DS-06, DS-12). Every state also has a human label; the UI shows the label, never
// the raw enum and never colour alone.
//
// Weight follows importance: `critical` and `done` render solid, `attention`, `active` and
// `waiting` render tinted with a border, `ended` renders as a grey outline (D-12a).

export type StatusTone = 'critical' | 'attention' | 'active' | 'waiting' | 'done' | 'ended';

export const TONE_GLYPH: Record<StatusTone, string> = {
  critical: '▲',
  attention: '!',
  active: '●',
  waiting: '◷',
  done: '✓',
  ended: '×',
};

/** Badge classes per tone. Solid tones carry a 1 px edge so the fill reads on every surface. */
export const TONE_CLASSES: Record<StatusTone, string> = {
  critical: 'bg-status-critical-strong text-status-critical-on border-status-critical-fg font-extrabold',
  attention: 'bg-status-attention-tint text-status-attention-fg border-status-attention-line font-bold',
  active: 'bg-status-active-tint text-status-active-fg border-status-active-line font-bold',
  waiting: 'bg-status-waiting-tint text-status-waiting-fg border-status-waiting-line font-bold',
  done: 'bg-status-done-strong text-status-done-on border-status-done-fg font-extrabold',
  ended: 'bg-transparent text-status-ended-fg border-line-strong font-semibold',
};

/** Text colour of a tone on a plain surface, for inline status text and icons. */
export const TONE_TEXT: Record<StatusTone, string> = {
  critical: 'text-status-critical-fg',
  attention: 'text-status-attention-fg',
  active: 'text-status-active-fg',
  waiting: 'text-status-waiting-fg',
  done: 'text-status-done-fg',
  ended: 'text-status-ended-fg',
};

export interface StatusEntry {
  label: string;
  tone: StatusTone;
}

type Palette<K extends string> = Record<K, StatusEntry>;

// Enums of backend/prisma/schema.prisma on 2026-10-27.

export type DeviceStatus =
  | 'IN_INTAKE'
  | 'AVAILABLE'
  | 'RESERVED'
  | 'RENTED'
  | 'RETURNED'
  | 'MAINTENANCE'
  | 'LOST'
  | 'RETIRED'
  | 'DISPOSED';

export const DEVICE_STATUS: Palette<DeviceStatus> = {
  IN_INTAKE: { label: 'In intake', tone: 'waiting' },
  AVAILABLE: { label: 'Available', tone: 'done' },
  RESERVED: { label: 'Reserved', tone: 'waiting' },
  RENTED: { label: 'Rented', tone: 'active' },
  RETURNED: { label: 'Returned, to inspect', tone: 'waiting' },
  MAINTENANCE: { label: 'Maintenance', tone: 'attention' },
  LOST: { label: 'Lost', tone: 'critical' },
  RETIRED: { label: 'Retired', tone: 'ended' },
  DISPOSED: { label: 'Disposed', tone: 'ended' },
};

export type ContractStatus =
  | 'REQUESTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'ACTIVE'
  | 'ENDING'
  | 'RETURN_DUE'
  | 'OVERDUE'
  | 'DEFAULTED'
  | 'RETURNED'
  | 'CLOSED';

export const CONTRACT_STATUS: Palette<ContractStatus> = {
  REQUESTED: { label: 'Requested', tone: 'waiting' },
  APPROVED: { label: 'Approved', tone: 'waiting' },
  REJECTED: { label: 'Rejected', tone: 'ended' },
  CANCELLED: { label: 'Cancelled', tone: 'ended' },
  ACTIVE: { label: 'Active', tone: 'active' },
  ENDING: { label: 'Ending', tone: 'attention' },
  RETURN_DUE: { label: 'Return due', tone: 'attention' },
  OVERDUE: { label: 'Overdue', tone: 'critical' },
  DEFAULTED: { label: 'Defaulted', tone: 'critical' },
  RETURNED: { label: 'Returned', tone: 'done' },
  CLOSED: { label: 'Closed', tone: 'done' },
};

export type InvoiceStatus = 'ISSUED' | 'PARTIALLY_PAID' | 'PAID';

export const INVOICE_STATUS: Palette<InvoiceStatus> = {
  ISSUED: { label: 'Issued', tone: 'active' },
  PARTIALLY_PAID: { label: 'Partly paid', tone: 'attention' },
  PAID: { label: 'Paid', tone: 'done' },
};

export type IncidentState =
  | 'DETECTED'
  | 'NOTIFY_PRIMARY'
  | 'NOTIFY_BACKUP'
  | 'NOTIFY_MANAGER'
  | 'UNROUTED'
  | 'ESCALATED'
  | 'REPORTED'
  | 'ACKNOWLEDGED'
  | 'RESPONDING'
  | 'RESOLVED'
  | 'FALSE_ALARM'
  | 'CLOSED';

export const INCIDENT_STATE: Palette<IncidentState> = {
  DETECTED: { label: 'Detected', tone: 'waiting' },
  NOTIFY_PRIMARY: { label: 'Notifying primary', tone: 'waiting' },
  NOTIFY_BACKUP: { label: 'Notifying backup', tone: 'attention' },
  NOTIFY_MANAGER: { label: 'Notifying manager', tone: 'attention' },
  UNROUTED: { label: 'Unrouted', tone: 'critical' },
  ESCALATED: { label: 'Escalated', tone: 'critical' },
  REPORTED: { label: 'Reported to authority', tone: 'attention' },
  ACKNOWLEDGED: { label: 'Acknowledged', tone: 'active' },
  RESPONDING: { label: 'Responding', tone: 'active' },
  RESOLVED: { label: 'Resolved', tone: 'done' },
  FALSE_ALARM: { label: 'False alarm', tone: 'ended' },
  CLOSED: { label: 'Closed', tone: 'done' },
};

/** Incident confidence: solid for confirmed, dashed outline with a question mark for suspected. */
export type IncidentConfidence = 'CONFIRMED' | 'SUSPECTED';

export const CONFIDENCE_LABEL: Record<IncidentConfidence, string> = {
  CONFIRMED: 'Confirmed',
  SUSPECTED: 'Suspected',
};

/** Live device marker states of the map (shared/ui/map). */
export type MarkerState = 'fresh' | 'attention' | 'stale' | 'sos';

export const MARKER_LABEL: Record<MarkerState, string> = {
  fresh: 'Fresh',
  attention: 'Needs attention',
  stale: 'Stale',
  sos: 'SOS',
};

/** Badge class string for a legacy `tone` prop (entities' *_TONES maps). */
export const toneClass = (tone: StatusTone): string => TONE_CLASSES[tone];
