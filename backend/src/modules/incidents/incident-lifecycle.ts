import { HttpStatus, Injectable } from '@nestjs/common';
import { AlertChannel, Incident, IncidentState, Prisma } from '@prisma/client';
import { DomainException, ErrorCode } from '../../common/errors';
import { AUDIT_RECORD, AuditRecordEvent } from '../platform/audit/audit-record.event';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
import { AlertDeliveriesRepository, NewAlertDelivery } from './alert-deliveries.repository';
import { IncidentsRepository } from './incidents.repository';

export type IncidentActor =
  | { kind: 'SYSTEM' | 'DEVICE' }
  | { kind: 'MEMBER'; id: string; organizationId: string; roles: string[] }
  | { kind: 'STAFF'; id: string; roles: string[] };

// Internal input from routing, not a public DTO or a substitute roster provider.
export interface IncidentRecipients {
  primary: readonly string[];
  backup: readonly string[];
  managers: readonly string[];
  staff: readonly string[];
}

export interface IncidentTransitionReason {
  code:
    | 'ROUTED'
    | 'EMPTY_TIER'
    | 'TIER_TIMEOUT'
    | 'ACKNOWLEDGED'
    | 'RESPONDING'
    | 'STALE_LIMIT'
    | 'OWNER_DEACTIVATED'
    | 'RESOLVED'
    | 'FALSE_ALARM'
    | 'AUTHORITY_REPORTED'
    | 'CASE_CLOSED'
    | 'REOPENED'
    | 'REOPEN_WINDOW_ENDED';
  at: Date;
  recipients: IncidentRecipients;
  expectedVersion?: number;
  note?: string;
  refEventId?: string;
  occurredAt?: Date;
  // Reopening must supply a fresh attribution, even when it is unchanged.
  route?: { organizationId: string | null; contractId: string | null };
}

type ReasonCode = IncidentTransitionReason['code'];
const EDGES: Readonly<Record<ReasonCode, readonly (readonly [IncidentState, IncidentState])[]>> = {
  ROUTED: [
    ['DETECTED', 'NOTIFY_PRIMARY'],
    ['DETECTED', 'UNROUTED'],
  ],
  EMPTY_TIER: [
    ['NOTIFY_PRIMARY', 'NOTIFY_BACKUP'],
    ['NOTIFY_BACKUP', 'NOTIFY_MANAGER'],
    ['NOTIFY_MANAGER', 'ESCALATED'],
  ],
  TIER_TIMEOUT: [
    ['NOTIFY_PRIMARY', 'NOTIFY_BACKUP'],
    ['NOTIFY_BACKUP', 'NOTIFY_MANAGER'],
    ['NOTIFY_MANAGER', 'ESCALATED'],
  ],
  ACKNOWLEDGED: [
    ['NOTIFY_PRIMARY', 'ACKNOWLEDGED'],
    ['NOTIFY_BACKUP', 'ACKNOWLEDGED'],
    ['NOTIFY_MANAGER', 'ACKNOWLEDGED'],
    ['ESCALATED', 'ACKNOWLEDGED'],
    ['REPORTED', 'ACKNOWLEDGED'],
  ],
  RESPONDING: [['ACKNOWLEDGED', 'RESPONDING']],
  STALE_LIMIT: [
    ['ACKNOWLEDGED', 'ESCALATED'],
    ['RESPONDING', 'ESCALATED'],
  ],
  OWNER_DEACTIVATED: [
    ['ACKNOWLEDGED', 'NOTIFY_BACKUP'],
    ['RESPONDING', 'NOTIFY_BACKUP'],
  ],
  RESOLVED: [
    ['ACKNOWLEDGED', 'RESOLVED'],
    ['RESPONDING', 'RESOLVED'],
  ],
  FALSE_ALARM: [
    ['NOTIFY_PRIMARY', 'FALSE_ALARM'],
    ['NOTIFY_BACKUP', 'FALSE_ALARM'],
    ['NOTIFY_MANAGER', 'FALSE_ALARM'],
    ['ACKNOWLEDGED', 'FALSE_ALARM'],
    ['RESPONDING', 'FALSE_ALARM'],
    ['UNROUTED', 'FALSE_ALARM'],
  ],
  AUTHORITY_REPORTED: [
    ['UNROUTED', 'REPORTED'],
    ['ESCALATED', 'REPORTED'],
  ],
  CASE_CLOSED: [['REPORTED', 'CLOSED']],
  REOPENED: [
    ['RESOLVED', 'NOTIFY_PRIMARY'],
    ['FALSE_ALARM', 'NOTIFY_PRIMARY'],
  ],
  REOPEN_WINDOW_ENDED: [
    ['RESOLVED', 'CLOSED'],
    ['FALSE_ALARM', 'CLOSED'],
  ],
};

const NEXT_TIER = {
  NOTIFY_PRIMARY: IncidentState.NOTIFY_BACKUP,
  NOTIFY_BACKUP: IncidentState.NOTIFY_MANAGER,
  NOTIFY_MANAGER: IncidentState.ESCALATED,
} as const;
type TimedTier = keyof typeof NEXT_TIER;
const isTier = (state: IncidentState): state is TimedTier => state in NEXT_TIER;
const tierOf = (state: IncidentState): string | null => (isTier(state) ? state.slice(7) : null);
const tierMembers = (state: TimedTier, recipients: IncidentRecipients): readonly string[] =>
  state === 'NOTIFY_PRIMARY'
    ? recipients.primary
    : state === 'NOTIFY_BACKUP'
      ? recipients.backup
      : recipients.managers;
const invalid = () =>
  new DomainException(
    HttpStatus.CONFLICT,
    ErrorCode.INVALID_STATE_TRANSITION,
    "This action is not allowed in the incident's current state.",
  );
const forbidden = () =>
  new DomainException(HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN, 'You do not have access to this.');
const stale = () =>
  new DomainException(
    HttpStatus.CONFLICT,
    ErrorCode.STALE_VERSION,
    'This was changed by someone else. Reload and try again.',
  );

@Injectable()
export class IncidentLifecycle {
  constructor(
    private readonly repository: IncidentsRepository,
    private readonly alerts: AlertDeliveriesRepository,
    private readonly parameters: ParameterService,
    private readonly events: TransactionalEvents,
  ) {}

  // The caller opens the operation through TransactionalEvents.transaction, as platform design §2.2
  // requires. No nested transaction: incident, history, report and outbox share the supplied tx.
  async apply(
    id: string,
    expectedState: IncidentState,
    to: IncidentState,
    actor: IncidentActor,
    reason: IncidentTransitionReason,
    tx: Prisma.TransactionClient,
  ): Promise<Incident> {
    const current = await this.repository.lockById(id, tx);
    if (!current || (actor.kind === 'MEMBER' && actor.organizationId !== current.organizationId)) {
      throw new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Incident not found.');
    }
    this.assertOwnerBeforeVersion(current, actor, reason.code);
    if (
      current.state !== expectedState ||
      (reason.expectedVersion !== undefined && current.version !== reason.expectedVersion)
    )
      throw stale();
    if (!EDGES[reason.code].some(([from, target]) => from === current.state && target === to))
      throw invalid();
    this.assertGuards(current, actor, reason);
    const patch = await this.patch(current, to, actor, reason, tx);
    const updated = await this.repository.compareAndSet(current, patch, tx);
    if (!updated) {
      const winner = await this.repository.lockById(id, tx);
      if (winner) this.assertOwnerBeforeVersion(winner, actor, reason.code);
      throw stale();
    }
    const transition = await this.repository.insertTransition(
      {
        incidentId: id,
        fromState: current.state,
        toState: to,
        actorId: 'id' in actor ? actor.id : null,
        reason: reason.code,
        note: reason.note,
        refEventId: reason.refEventId,
        createdAt: reason.at,
      },
      tx,
    );
    await this.alerts.enqueue(this.deliveries(updated, transition.id, reason.recipients), tx);
    this.events.emitAfterCommit('incident.changed', {
      incidentId: id,
      organizationId: updated.organizationId,
      state: to,
      tier: tierOf(to),
      ownerId: updated.ownerId,
    });
    this.events.emitAfterCommit(AUDIT_RECORD, {
      actorId: 'id' in actor ? actor.id : null,
      actorRoles: 'roles' in actor ? actor.roles : [],
      organizationId: updated.organizationId,
      action: 'incident.transition',
      subjectType: 'Incident',
      subjectId: id,
      before: { state: current.state, version: current.version, ownerId: current.ownerId },
      after: { state: to, version: updated.version, ownerId: updated.ownerId, reason: reason.code },
    } satisfies AuditRecordEvent);
    if (isTier(to) && tierMembers(to, reason.recipients).length === 0) {
      return this.apply(
        id,
        to,
        NEXT_TIER[to],
        { kind: 'SYSTEM' },
        {
          ...reason,
          code: 'EMPTY_TIER',
          expectedVersion: updated.version,
        },
        tx,
      );
    }
    return updated;
  }

  private assertOwnerBeforeVersion(
    current: Incident,
    actor: IncidentActor,
    reason: ReasonCode,
  ): void {
    if (
      reason === 'ACKNOWLEDGED' &&
      current.ownerId &&
      'id' in actor &&
      current.ownerId !== actor.id
    ) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        ErrorCode.ALREADY_OWNED,
        `Account ${current.ownerId} already owns this incident.`,
      );
    }
  }

  private assertGuards(
    current: Incident,
    actor: IncidentActor,
    reason: IncidentTransitionReason,
  ): void {
    const { code, at } = reason;
    if (!Number.isFinite(at.getTime())) throw invalid();
    if (
      code === 'ACKNOWLEDGED' ||
      code === 'RESPONDING' ||
      code === 'RESOLVED' ||
      (code === 'FALSE_ALARM' && current.state !== 'UNROUTED')
    ) {
      if (
        actor.kind !== 'MEMBER' ||
        !actor.roles.some((role) => role === 'ORG_OPERATOR' || role === 'ORG_MANAGER')
      )
        throw forbidden();
      if ((code === 'RESPONDING' || code === 'RESOLVED') && current.ownerId !== actor.id) {
        throw new DomainException(
          HttpStatus.FORBIDDEN,
          ErrorCode.NOT_OWNER,
          'You do not have access to this.',
        );
      }
    } else if (code === 'AUTHORITY_REPORTED' || code === 'CASE_CLOSED' || code === 'FALSE_ALARM') {
      if (
        actor.kind !== 'STAFF' ||
        !actor.roles.some((role) => role === 'STAFF' || role === 'ADMIN')
      )
        throw forbidden();
    } else if (actor.kind !== 'SYSTEM' && !(actor.kind === 'DEVICE' && code === 'REOPENED')) {
      throw invalid();
    }
    if ((code === 'FALSE_ALARM' || code === 'RESOLVED') && !reason.note?.trim()) {
      throw new DomainException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'A reason or outcome note is required.',
      );
    }
    if (code === 'TIER_TIMEOUT' && (!current.tierDeadlineAt || current.tierDeadlineAt > at))
      throw invalid();
    if (code === 'STALE_LIMIT' && (!current.statusDueAt || current.statusDueAt > at))
      throw invalid();
    if (
      code === 'REOPEN_WINDOW_ENDED' &&
      (!current.reopenWindowEndsAt || current.reopenWindowEndsAt > at)
    )
      throw invalid();
    if (
      code === 'EMPTY_TIER' &&
      (!isTier(current.state) || tierMembers(current.state, reason.recipients).length > 0)
    )
      throw invalid();
    if (
      code === 'REOPENED' &&
      (!reason.route ||
        !reason.occurredAt ||
        !current.reopenWindowEndsAt ||
        !(
          reason.occurredAt >= current.stateChangedAt &&
          reason.occurredAt < current.reopenWindowEndsAt
        ))
    )
      throw invalid();
    if (code === 'OWNER_DEACTIVATED' && !current.ownerId) throw invalid();
  }

  private async patch(
    current: Incident,
    to: IncidentState,
    actor: IncidentActor,
    reason: IncidentTransitionReason,
    tx: Prisma.TransactionClient,
  ): Promise<Prisma.IncidentUncheckedUpdateManyInput> {
    const patch: Prisma.IncidentUncheckedUpdateManyInput = {
      state: to,
      stateChangedAt: reason.at,
      tierDeadlineAt: null,
      statusDueAt: null,
      reopenWindowEndsAt: null,
    };
    if (reason.code === 'REOPENED')
      Object.assign(patch, reason.route, {
        ownerId: null,
        acknowledgedAt: null,
        resolvedAt: null,
        outcomeNote: null,
        falseAlarmReason: null,
        reopenCount: { increment: 1 },
        closedAt: null,
      });
    if (isTier(to)) {
      const organizationId =
        reason.code === 'REOPENED' ? reason.route!.organizationId : current.organizationId;
      if (!organizationId) throw invalid();
      const key =
        to === 'NOTIFY_PRIMARY'
          ? 'incidents.primaryAckTimeoutSeconds'
          : to === 'NOTIFY_BACKUP'
            ? 'incidents.backupAckTimeoutSeconds'
            : 'incidents.managerAckTimeoutSeconds';
      patch.tierDeadlineAt = new Date(
        reason.at.getTime() + (await this.parameters.get(key, tx)) * 1000,
      );
      patch.ownerId = null;
    } else if (to === 'ACKNOWLEDGED' || to === 'RESPONDING') {
      patch.ownerId = to === 'ACKNOWLEDGED' && 'id' in actor ? actor.id : current.ownerId;
      if (!patch.ownerId) throw invalid();
      patch.statusDueAt = new Date(
        reason.at.getTime() +
          (await this.parameters.get('incidents.staleLimitMinutes', tx)) * 60000,
      );
      if (to === 'ACKNOWLEDGED') patch.acknowledgedAt = current.acknowledgedAt ?? reason.at;
    } else if (to === 'RESOLVED' || to === 'FALSE_ALARM') {
      patch.reopenWindowEndsAt = new Date(
        reason.at.getTime() +
          (await this.parameters.get('incidents.reopenWindowMinutes', tx)) * 60000,
      );
      if (to === 'RESOLVED')
        Object.assign(patch, { resolvedAt: reason.at, outcomeNote: reason.note });
      else patch.falseAlarmReason = reason.note;
    } else if (to === 'UNROUTED') patch.ownerId = null;
    else if (to === 'CLOSED') patch.closedAt = reason.at;
    return patch;
  }

  private deliveries(
    incident: Incident,
    transitionId: string,
    recipients: IncidentRecipients,
  ): NewAlertDelivery[] {
    const rows: NewAlertDelivery[] = [];
    let ids: readonly string[] = [];
    let tier: string = 'TREKLINK';
    if (isTier(incident.state)) {
      ids = tierMembers(incident.state, recipients);
      tier = tierOf(incident.state)!;
    } else if (incident.state === 'ESCALATED') ids = [...recipients.staff, ...recipients.managers];
    else if (incident.state === 'UNROUTED') ids = recipients.staff;
    for (const recipientId of new Set(ids)) {
      for (const channel of [AlertChannel.WEB, AlertChannel.WEBSOCKET, AlertChannel.EMAIL]) {
        const recipientTier =
          incident.state === 'ESCALATED' && !recipients.staff.includes(recipientId)
            ? 'MANAGER'
            : tier;
        rows.push({
          incidentId: incident.id,
          transitionId,
          tier: recipientTier,
          recipientId,
          channel,
        });
      }
    }
    if (incident.organizationId)
      rows.push({
        incidentId: incident.id,
        transitionId,
        tier,
        recipientId: null,
        channel: AlertChannel.API_EVENT,
      });
    return rows;
  }
}
