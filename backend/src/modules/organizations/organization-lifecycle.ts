import { HttpStatus, Injectable } from '@nestjs/common';
import { OrganizationStatus, Prisma } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { AUDIT_RECORD, AuditRecordEvent } from '../platform/audit/audit-record.event';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ORGANIZATION_STATUS_CHANGED, OrganizationStatusChangedEvent } from './organization-events';
import { OrganizationReviewRow, OrganizationsRepository } from './organizations.repository';

// The organization lifecycle of D-035 (design §2): the statuses each one may move to. Verification is a
// recorded fact on a PENDING organization, not a status. REJECTED and CLOSED are final.
const TRANSITIONS: Readonly<Record<OrganizationStatus, readonly OrganizationStatus[]>> = {
  [OrganizationStatus.PENDING]: [OrganizationStatus.ACTIVE, OrganizationStatus.REJECTED],
  [OrganizationStatus.ACTIVE]: [OrganizationStatus.SUSPENDED, OrganizationStatus.CLOSED],
  [OrganizationStatus.SUSPENDED]: [OrganizationStatus.ACTIVE],
  [OrganizationStatus.REJECTED]: [],
  [OrganizationStatus.CLOSED]: [],
};

export const canTransition = (from: OrganizationStatus, to: OrganizationStatus): boolean =>
  TRANSITIONS[from].includes(to);

export const invalidState = (status: OrganizationStatus) =>
  new DomainException(
    HttpStatus.CONFLICT,
    ErrorCode.INVALID_STATE_TRANSITION,
    `This cannot be done while it is ${status}.`,
  );

export interface TransitionInput {
  // The version the caller saw; another change in between is 409 STALE_VERSION.
  expectedVersion: number;
  at: Date;
  // The Admin or Staff account, or null for SYSTEM (a contract that defaulted).
  actor: Caller | null;
  reason: string | null;
  // Columns written with the status, such as the decision or the suspension reason.
  data?: Prisma.OrganizationUpdateManyMutationInput & { decidedById?: string };
  // The audit action, such as `organization.suspended`.
  audit: string;
  // Runs on the locked row once the pair of statuses is known to be allowed and before anything is
  // written: a rule of the caller that the table does not hold (approval needs a verification, a
  // closing needs no open contract).
  guard?: (current: OrganizationReviewRow, tx: Prisma.TransactionClient) => void | Promise<void>;
}

// Every change of an organization's status goes through here (organizations task 1.2, REQ-UBI-01,
// FR-ORG-07): the row is locked, the pair of statuses checked against the lifecycle table (409
// INVALID_STATE_TRANSITION), the version compared and set (409 STALE_VERSION), one append-only
// transition row written, and `organization.statusChanged` and `audit.record` emitted after commit.
// It runs in the caller's transaction, so a change of status and the work that goes with it, such as
// the deactivation of members on a closing, commit or roll back together.
@Injectable()
export class OrganizationLifecycle {
  constructor(
    private readonly organizations: OrganizationsRepository,
    private readonly events: TransactionalEvents,
  ) {}

  async transition(
    organizationId: string,
    to: OrganizationStatus,
    input: TransitionInput,
    tx: Prisma.TransactionClient,
  ): Promise<OrganizationReviewRow> {
    const current = await this.organizations.lockById(organizationId, tx);
    if (!current) {
      throw new DomainException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Organization not found.',
      );
    }
    if (!canTransition(current.status, to)) throw invalidState(current.status);
    await input.guard?.(current, tx);
    const saved = await this.organizations.update(
      organizationId,
      input.expectedVersion,
      { ...input.data, status: to, statusChangedAt: input.at },
      tx,
    );
    if (!saved) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        ErrorCode.STALE_VERSION,
        'Someone else changed this. Reload to see the latest.',
      );
    }
    await this.organizations.addTransition(
      {
        organizationId,
        fromStatus: current.status,
        toStatus: to,
        actorId: input.actor?.id ?? null,
        reason: input.reason,
      },
      tx,
    );
    this.events.emitAfterCommit(ORGANIZATION_STATUS_CHANGED, {
      organizationId,
      from: current.status,
      to,
      reason: input.reason,
    } satisfies OrganizationStatusChangedEvent);
    this.events.emitAfterCommit(AUDIT_RECORD, {
      actorId: input.actor?.id ?? null,
      actorRoles: input.actor?.roles ?? [],
      organizationId,
      action: input.audit,
      subjectType: 'Organization',
      subjectId: organizationId,
      before: { status: current.status },
      after: { status: to, reason: input.reason },
    } satisfies AuditRecordEvent);
    return saved;
  }
}
