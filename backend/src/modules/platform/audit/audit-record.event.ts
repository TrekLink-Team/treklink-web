export const AUDIT_RECORD = 'audit.record';

// Payload of the `audit.record` domain event (specs/platform/design.md §2.3, REQ-EVT-02). Any
// module emits it through TransactionalEvents.emitAfterCommit; AuditSinkListener persists it.
export interface AuditRecordEvent {
  actorId: string | null;
  actorRoles: string[];
  // The tenant the action belongs to; null for a platform-wide action (REQ-UBI-10).
  organizationId: string | null;
  action: string; // "contract.approve", "member.deactivate"
  subjectType: string;
  subjectId: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  // Defaults to the correlation id of the request the event was emitted in.
  requestId?: string;
}
