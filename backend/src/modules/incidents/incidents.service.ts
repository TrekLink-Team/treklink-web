import { HttpStatus, Injectable } from '@nestjs/common';
import { Incident, IncidentState, Prisma } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { AUDIT_RECORD, AuditRecordEvent } from '../platform/audit/audit-record.event';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { OrganizationsService } from '../organizations';
import { ParameterService } from '../platform/parameters/parameter.service';
import {
  IncidentActor,
  IncidentLifecycle,
  IncidentRecipients,
  IncidentTransitionReason,
  tierOf,
} from './incident-lifecycle';
import { clockTime } from './display-time';
import { IncidentsRepository } from './incidents.repository';

export interface AcknowledgeInput {
  expectedVersion: number;
  note?: string;
}

export interface RespondingInput {
  expectedVersion: number;
  note: string;
}

export interface StatusUpdateInput {
  note: string;
  // The earlier update this one corrects (dry run defect 15); the earlier row is never edited.
  correctsId?: string;
}

export interface ResolveInput {
  expectedVersion: number;
  outcomeNote: string;
}

export interface FalseAlarmInput {
  expectedVersion: number;
  reason: string;
}

export interface StatusUpdateResult {
  id: string;
  note: string;
  createdAt: Date;
  statusDueAt: Date;
  correctsId: string | null;
}

type MemberActor = Extract<IncidentActor, { kind: 'MEMBER' }>;

// Owner actions alert nobody: these edges enqueue only the organization's API event.
const NO_RECIPIENTS: IncidentRecipients = { primary: [], backup: [], managers: [], staff: [] };
const OWNED_STATES: readonly IncidentState[] = ['ACKNOWLEDGED', 'RESPONDING'];
const MEMBER_ROLES = ['ORG_OPERATOR', 'ORG_MANAGER'];

const notFound = () =>
  new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Incident not found.');
const forbidden = () =>
  new DomainException(HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN, 'You do not have access to this.');
const required = (value: string | undefined, field: string): string => {
  const trimmed = value?.trim();
  if (!trimmed)
    throw new DomainException(
      HttpStatus.BAD_REQUEST,
      ErrorCode.VALIDATION_FAILED,
      `${field} is required.`,
    );
  return trimmed;
};

// Owner actions of UC-32 and UC-33 (incidents task 4.1). State rules, ownership, versions, timers,
// history and the outbox stay in IncidentLifecycle; this service supplies the locked source state,
// the request time and the caller. The loser of a concurrent acknowledgement receives MSG27 with the
// owner's name and time.
@Injectable()
export class IncidentsService {
  constructor(
    private readonly repository: IncidentsRepository,
    private readonly lifecycle: IncidentLifecycle,
    private readonly parameters: ParameterService,
    private readonly events: TransactionalEvents,
    private readonly organizations: OrganizationsService,
  ) {}

  async acknowledge(id: string, input: AcknowledgeInput, caller: Caller): Promise<Incident> {
    try {
      return await this.transition(id, 'ACKNOWLEDGED', caller, {
        code: 'ACKNOWLEDGED',
        expectedVersion: input.expectedVersion,
        note: input.note?.trim() || undefined,
      });
    } catch (error) {
      if (error instanceof DomainException && error.errorCode === ErrorCode.ALREADY_OWNED)
        throw await this.alreadyOwned(id);
      throw error;
    }
  }

  // UC-34 (api-design 07): members stay scoped to their organization; TrekLink actors may only
  // end an UNROUTED episode. The lifecycle owns the version, history and reopen window.
  async falseAlarm(id: string, input: FalseAlarmInput, caller: Caller): Promise<Incident> {
    const note = required(input.reason, 'reason');
    if (caller.roles.some((role) => role === 'STAFF' || role === 'ADMIN')) {
      return this.events.transaction(async (tx) => {
        const current = await this.repository.lockById(id, tx);
        if (!current) throw notFound();
        if (current.state !== 'UNROUTED')
          throw new DomainException(
            HttpStatus.CONFLICT,
            ErrorCode.INVALID_STATE_TRANSITION,
            `This cannot be done while it is ${current.state}.`,
          );
        return this.lifecycle.apply(
          id,
          current.state,
          'FALSE_ALARM',
          { kind: 'STAFF', id: caller.id, roles: caller.roles },
          {
            code: 'FALSE_ALARM',
            expectedVersion: input.expectedVersion,
            note,
            at: new Date(),
            recipients: NO_RECIPIENTS,
          },
          tx,
        );
      });
    }
    return this.transition(id, 'FALSE_ALARM', caller, {
      code: 'FALSE_ALARM',
      expectedVersion: input.expectedVersion,
      note,
    });
  }

  async responding(id: string, input: RespondingInput, caller: Caller): Promise<Incident> {
    return this.transition(id, 'RESPONDING', caller, {
      code: 'RESPONDING',
      expectedVersion: input.expectedVersion,
      note: required(input.note, 'note'),
    });
  }

  async resolve(id: string, input: ResolveInput, caller: Caller): Promise<Incident> {
    return this.transition(id, 'RESOLVED', caller, {
      code: 'RESOLVED',
      expectedVersion: input.expectedVersion,
      note: required(input.outcomeNote, 'outcomeNote'),
    });
  }

  // Appends a note and restarts the stale timer without a state change (api-design 05, design Figure 9).
  async addStatus(
    id: string,
    input: StatusUpdateInput,
    caller: Caller,
  ): Promise<StatusUpdateResult> {
    const actor = this.member(caller);
    const note = required(input.note, 'note');
    return this.events.transaction(async (tx) => {
      const current = await this.lock(id, actor, tx);
      if (!OWNED_STATES.includes(current.state))
        throw new DomainException(
          HttpStatus.CONFLICT,
          ErrorCode.INVALID_STATE_TRANSITION,
          "This action is not allowed in the incident's current state.",
        );
      if (!actor.roles.some((role) => MEMBER_ROLES.includes(role))) throw forbidden();
      if (current.ownerId !== actor.id)
        throw new DomainException(
          HttpStatus.FORBIDDEN,
          ErrorCode.NOT_OWNER,
          'You do not have access to this.',
        );
      const correctsId = input.correctsId ?? null;
      if (correctsId) await this.correctable(correctsId, id, tx);
      const at = new Date();
      const statusDueAt = new Date(
        at.getTime() + (await this.parameters.get('incidents.staleLimitMinutes', tx)) * 60000,
      );
      const update = await this.repository.insertStatusUpdate(
        { incidentId: id, authorId: actor.id, note, createdAt: at, correctsId },
        tx,
      );
      await this.repository.resetStatusDue(id, statusDueAt, tx);
      this.events.emitAfterCommit('incident.changed', {
        incidentId: id,
        deviceId: current.deviceId,
        organizationId: current.organizationId,
        state: current.state,
        tier: null,
        ownerId: current.ownerId,
      });
      this.events.emitAfterCommit(AUDIT_RECORD, {
        actorId: actor.id,
        actorRoles: actor.roles,
        organizationId: current.organizationId,
        action: 'incident.status_update',
        subjectType: 'Incident',
        subjectId: id,
        before: { statusDueAt: current.statusDueAt },
        after: { statusDueAt, statusUpdateId: update.id, correctsId },
      } satisfies AuditRecordEvent);
      return {
        id: update.id,
        note: update.note,
        createdAt: update.createdAt,
        statusDueAt,
        correctsId,
      };
    });
  }

  // A correction names an update of the same incident that no other row corrects yet. A foreign or
  // unknown id is 400, a second correction 409; both run under the incident row lock.
  private async correctable(correctsId: string, incidentId: string, tx: Prisma.TransactionClient) {
    const target = await this.repository.findStatusUpdateForCorrection(correctsId, tx);
    if (!target || target.incidentId !== incidentId)
      throw new DomainException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'correctsId must name a status update of this incident.',
      );
    if (target.correctedBy)
      throw new DomainException(
        HttpStatus.CONFLICT,
        ErrorCode.CONFLICT_UNIQUE,
        'This status update is already corrected.',
      );
  }

  private async transition(
    id: string,
    to: IncidentState,
    caller: Caller,
    reason: Omit<IncidentTransitionReason, 'at' | 'recipients'>,
  ): Promise<Incident> {
    const actor = this.member(caller);
    return this.events.transaction(async (tx) => {
      // Acknowledge accepts five source states, so the locked row supplies the expected state. A
      // concurrent loser waits here and then reads the winner's owner (ALREADY_OWNED).
      const current = await this.lock(id, actor, tx);
      return this.lifecycle.apply(
        id,
        current.state,
        to,
        actor,
        { ...reason, at: new Date(), recipients: NO_RECIPIENTS },
        tx,
      );
    });
  }

  // MSG27, read after the losing transaction rolled back: the owner's name and the time of the latest
  // acknowledgement, because `acknowledgedAt` keeps the first one after an escalation takeover.
  private async alreadyOwned(id: string): Promise<DomainException> {
    const latest = await this.repository.latestAcknowledgement(id);
    const names = await this.organizations.memberNames(latest?.actorId ? [latest.actorId] : []);
    const name = (latest?.actorId && names.get(latest.actorId)) || 'Another member';
    const time = latest ? ` at ${clockTime(latest.createdAt)}` : '';
    return new DomainException(
      HttpStatus.CONFLICT,
      ErrorCode.ALREADY_OWNED,
      `${name} took this incident${time}.`,
    );
  }

  // The monitoring staleness sweep reports the device silent past `monitoring.deviceStaleSeconds`, or
  // heard again (REQ-EVT-12, FR-INC-13, task 4.4). The device's incident outside CLOSED, if any, is
  // flagged or cleared under its row lock inside the sweep's transaction; nothing else of it changes,
  // its version included. The incident keeps its own last position and fix time (`lastPositionAt`),
  // which the device's episode wrote; `lastSeenAt` is the device's last reading and goes to the audit
  // record, null when the sweep clears the flag of a device reset to never heard. Returns the changed
  // incident, or null when there is none or the flag already says so.
  async markDeviceStale(
    deviceId: string,
    stale: boolean,
    lastSeenAt: Date | null,
    tx: Prisma.TransactionClient,
  ): Promise<Incident | null> {
    const current = await this.repository.lockOpenByDevice(deviceId, tx);
    if (!current || current.stale === stale) return null;
    const updated = await this.repository.setStale(current.id, stale, tx);
    this.events.emitAfterCommit('incident.changed', {
      incidentId: current.id,
      deviceId: current.deviceId,
      organizationId: current.organizationId,
      state: current.state,
      tier: tierOf(current.state),
      ownerId: current.ownerId,
    });
    this.events.emitAfterCommit(AUDIT_RECORD, {
      actorId: null,
      actorRoles: [],
      organizationId: current.organizationId,
      action: 'incident.stale',
      subjectType: 'Incident',
      subjectId: current.id,
      before: { stale: current.stale },
      after: { stale, lastSeenAt: lastSeenAt?.toISOString() ?? null },
    } satisfies AuditRecordEvent);
    return updated;
  }

  private async lock(
    id: string,
    actor: MemberActor,
    tx: Prisma.TransactionClient,
  ): Promise<Incident> {
    const current = await this.repository.lockById(id, tx);
    if (!current || current.organizationId !== actor.organizationId) throw notFound();
    return current;
  }

  // Owner actions belong to members of the routed organization; a TrekLink account has none.
  private member(caller: Caller): MemberActor {
    if (!caller.organizationId) throw forbidden();
    return {
      kind: 'MEMBER',
      id: caller.id,
      organizationId: caller.organizationId,
      roles: caller.roles,
    };
  }
}
