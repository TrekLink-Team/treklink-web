import { subject } from '@casl/ability';
import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import { OrganizationStatus, Prisma } from '@prisma/client';
import { Caller, type PolicyAbility } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { AccountsService, MEMBER_DEACTIVATED } from '../auth';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { API_KEY_REVOKED, ApiKeyRevokedEvent } from './api-key-events';
import { ApiKeysRepository } from './api-keys.repository';
import { FIELD_STATION_REVOKED, FieldStationRevokedEvent } from './field-station-events';
import { FieldStationsRepository } from './field-stations.repository';
import { MembersRepository } from './members.repository';
import { invalidState, OrganizationLifecycle } from './organization-lifecycle';
import { OrganizationReviewRow, OrganizationsRepository } from './organizations.repository';
import { OrganizationsService } from './organizations.service';
import {
  ExitBlockingReason,
  ORGANIZATION_EXIT_CHECKS,
  OrganizationExitCheck,
} from './ports/exit-checks.port';

export interface TransitionView {
  fromStatus: OrganizationStatus | null;
  toStatus: OrganizationStatus;
  // "SYSTEM" for a change no account made (a contract that defaulted), else the account's name.
  actor: string;
  reason: string | null;
  createdAt: Date;
}

const notFound = () =>
  new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Organization not found.');

const managerOnly = () =>
  new DomainException(
    HttpStatus.FORBIDDEN,
    ErrorCode.FORBIDDEN,
    'Only the Manager of the organization may read its status history.',
  );

const blocked = (reason: ExitBlockingReason) =>
  new DomainException(HttpStatus.CONFLICT, reason.code as ErrorCode, reason.message);

// Suspension, reactivation and closing of an organization by an Admin (organizations task 2.4,
// api-design 08 to 11, UC-07, FR-ORG-07, D-035) and the status history. The status change itself is
// `OrganizationLifecycle`; this service adds the rules of each change and the work that goes with it.
// `suspendForDefault`, the change a defaulted contract asks for, is on `OrganizationsService`.
@Injectable()
export class OrganizationStatusService {
  constructor(
    private readonly lifecycle: OrganizationLifecycle,
    private readonly organizations: OrganizationsRepository,
    private readonly organizationsService: OrganizationsService,
    private readonly members: MembersRepository,
    private readonly apiKeys: ApiKeysRepository,
    private readonly stations: FieldStationsRepository,
    private readonly accounts: AccountsService,
    private readonly events: TransactionalEvents,
    @Optional()
    @Inject(ORGANIZATION_EXIT_CHECKS)
    private readonly checks: OrganizationExitCheck[] = [],
  ) {}

  // api-design 08: an ACTIVE organization is suspended with a reason, shown to its Manager by email.
  // New contracts are refused while it is suspended; its roster and keys still resolve (REQ-STA-01).
  async suspend(
    id: string,
    reason: string,
    expectedVersion: number,
    admin: Caller,
    at: Date = new Date(),
  ): Promise<OrganizationReviewRow> {
    const saved = await this.events.transaction((tx) =>
      this.lifecycle.transition(
        id,
        OrganizationStatus.SUSPENDED,
        {
          expectedVersion,
          at,
          actor: admin,
          reason,
          data: { suspensionReason: reason },
          audit: 'organization.suspended',
        },
        tx,
      ),
    );
    await this.organizationsService.emailContact(
      id,
      `Your TrekLink organization ${saved.code} is suspended`,
      `${saved.legalName} was suspended: ${reason}\n\nNew contracts are not accepted while it is suspended. ` +
        'Your rented devices stay monitored and your incidents are still routed. Contact TrekLink to resolve it.',
    );
    return saved;
  }

  // api-design 09: a SUSPENDED organization returns to ACTIVE when every check reports nothing
  // outstanding (409 BALANCE_OUTSTANDING).
  async reactivate(
    id: string,
    expectedVersion: number,
    admin: Caller,
    at: Date = new Date(),
  ): Promise<OrganizationReviewRow> {
    const saved = await this.events.transaction((tx) =>
      this.lifecycle.transition(
        id,
        OrganizationStatus.ACTIVE,
        {
          expectedVersion,
          at,
          actor: admin,
          reason: null,
          data: { suspensionReason: null },
          audit: 'organization.reactivated',
          guard: async (current) => {
            if (current.status !== OrganizationStatus.SUSPENDED) throw invalidState(current.status);
            for (const check of this.checks) {
              const reason = await check.canReactivate(id, tx, at);
              if (reason) throw blocked(reason);
            }
          },
        },
        tx,
      ),
    );
    await this.organizationsService.emailContact(
      id,
      `Your TrekLink organization ${saved.code} is active again`,
      `${saved.legalName} is active again. Your members can request devices.`,
    );
    return saved;
  }

  // api-design 10: an ACTIVE organization with no open contract (409 OPEN_CONTRACTS) is closed. In the
  // same transaction its members are deactivated and its API keys and Field Station credentials
  // revoked, and each of those tells the module that listens (REQ-EVT-06). Their slots in the roster
  // are left: nothing is routed to a closed organization.
  async close(
    id: string,
    reason: string,
    expectedVersion: number,
    admin: Caller,
    at: Date = new Date(),
  ): Promise<OrganizationReviewRow> {
    return this.events.transaction(async (tx) => {
      const saved = await this.lifecycle.transition(
        id,
        OrganizationStatus.CLOSED,
        {
          expectedVersion,
          at,
          actor: admin,
          reason,
          audit: 'organization.closed',
          guard: async () => {
            for (const check of this.checks) {
              const blocker = await check.canClose(id, tx);
              if (blocker) throw blocked(blocker);
            }
          },
        },
        tx,
      );
      await this.wind(id, reason, admin, at, tx);
      return saved;
    });
  }

  // api-design 11: the append-only history, for Staff and Admin and for the Manager of the organization.
  // An Org Operator shares `organization.read.own` but may not read suspension reasons (leader ruling
  // on treklink-web#135): a member caller needs `organization.history.read.own`, 403 without it before
  // anything is read, and 404 for another organization's id.
  async transitions(
    organizationId: string,
    caller: Caller,
    ability: PolicyAbility,
  ): Promise<TransitionView[]> {
    if (caller.organizationId !== null) {
      if (!ability.can('readHistory', 'Organization')) throw managerOnly();
      if (!ability.can('readHistory', subject('Organization', { id: organizationId }))) {
        throw notFound();
      }
    }
    if ((await this.organizations.findStatus(organizationId)) === null) throw notFound();
    const rows = await this.organizations.transitionsOf(organizationId);
    const ids = [
      ...new Set(rows.map((row) => row.actorId).filter((id): id is string => id !== null)),
    ];
    const cards = await this.accounts.contactCard(ids);
    const nameOf = new Map(cards.map((card) => [card.id, card.fullName]));
    return rows.map((row) => ({
      fromStatus: row.fromStatus,
      toStatus: row.toStatus,
      actor: row.actorId === null ? 'SYSTEM' : (nameOf.get(row.actorId) ?? 'Unknown account'),
      reason: row.reason,
      createdAt: row.createdAt,
    }));
  }

  private async wind(
    organizationId: string,
    reason: string,
    admin: Caller,
    at: Date,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    for (const member of await this.members.membersOf(organizationId, false, tx)) {
      await this.accounts.deactivateOrganizationAccount(member.userId, reason, admin, tx, at);
      await this.members.markDeactivated(member.id, at, tx);
      this.events.emitAfterCommit(MEMBER_DEACTIVATED, { userId: member.userId });
    }
    for (const apiKeyId of await this.apiKeys.revokeAllActive(organizationId, admin.id, at, tx)) {
      this.events.emitAfterCommit(API_KEY_REVOKED, {
        organizationId,
        apiKeyId,
      } satisfies ApiKeyRevokedEvent);
    }
    for (const station of await this.stations.revokeAllActive(organizationId, admin.id, at, tx)) {
      this.events.emitAfterCommit(FIELD_STATION_REVOKED, {
        organizationId,
        fieldStationId: station.id,
        mqttUsername: station.mqttUsername,
      } satisfies FieldStationRevokedEvent);
    }
  }
}
