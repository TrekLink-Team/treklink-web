import { HttpStatus, Injectable } from '@nestjs/common';
import { MemberRole, OrganizationStatus, Prisma } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import {
  AccountsService,
  type ContactCard,
  MEMBER_DEACTIVATED,
  type OrganizationRole,
} from '../auth';
import { AUDIT_RECORD, AuditRecordEvent } from '../platform/audit/audit-record.event';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { MemberRow, MembersRepository } from './members.repository';
import { OrganizationsRepository } from './organizations.repository';
import { MemberView } from './organizations.service';
import { RosterRepository } from './roster.repository';

export interface MemberInvitation {
  email: string;
  fullName: string;
  phoneNumber?: string;
  role: MemberRole;
}

const ORGANIZATION_ROLE: Record<MemberRole, OrganizationRole> = {
  [MemberRole.MANAGER]: 'ORG_MANAGER',
  [MemberRole.OPERATOR]: 'ORG_OPERATOR',
};

// Members can be managed while the organization is ACTIVE, and while it is SUSPENDED because its
// roster and keys still resolve then (REQ-STA-01). Any other status is refused.
const MANAGEABLE: ReadonlySet<OrganizationStatus> = new Set([
  OrganizationStatus.ACTIVE,
  OrganizationStatus.SUSPENDED,
]);

const notFound = (what: string) =>
  new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, `${what} not found.`);

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

// Members of an organization, managed by its Org Managers (organizations task 2.5, api-design 13 to
// 15, UC-04, FR-ORG-04): an invitation creates the account through `auth` with a set-password code,
// a role change and a deactivation go through `auth` too, and the organization keeps at least one
// active Manager. Every change runs under a row lock on the organization, so two Managers changing
// the last two Managers at once leave one (AC-03). Reads stay with `OrganizationsService.membersOf`.
@Injectable()
export class MembersService {
  constructor(
    private readonly organizations: OrganizationsRepository,
    private readonly members: MembersRepository,
    private readonly roster: RosterRepository,
    private readonly accounts: AccountsService,
    private readonly events: TransactionalEvents,
  ) {}

  // api-design 13: a new member, created inactive with a SET_PASSWORD invitation sent after commit.
  // An email registered anywhere is 409 CONFLICT_UNIQUE (MSG10).
  async invite(
    organizationId: string,
    input: MemberInvitation,
    caller: Caller,
  ): Promise<MemberView> {
    this.assertOwn(organizationId, caller);
    try {
      return await this.events.transaction(async (tx) => {
        await this.lockManageable(organizationId, tx);
        const account = await this.accounts.createOrganizationAccount(
          {
            email: input.email,
            fullName: input.fullName,
            phone: input.phoneNumber ?? null,
            role: ORGANIZATION_ROLE[input.role],
            createdById: caller.id,
          },
          tx,
        );
        const member = await this.members.addMember(
          { organizationId, userId: account.id, role: input.role, invitedById: caller.id },
          tx,
        );
        this.audit(caller, organizationId, 'member.invited', null, {
          memberId: member.id,
          role: input.role,
        });
        return toView(member, account);
      });
    } catch (error) {
      // Two invitations racing for one email: the unique index decides.
      if (isUniqueViolation(error)) {
        throw new DomainException(
          HttpStatus.CONFLICT,
          ErrorCode.CONFLICT_UNIQUE,
          'This email is already registered.',
        );
      }
      throw error;
    }
  }

  // api-design 14: the new role applies on the member's next request. A Manager may demote themselves
  // while another active Manager remains; the last one is refused (409 LAST_MANAGER, AC-03).
  async changeRole(
    organizationId: string,
    memberId: string,
    role: MemberRole,
    caller: Caller,
  ): Promise<MemberView> {
    this.assertOwn(organizationId, caller);
    return this.events.transaction(async (tx) => {
      await this.lockManageable(organizationId, tx);
      const member = await this.liveMember(organizationId, memberId, tx);
      if (member.role === role) return this.view(member);
      if (member.role === MemberRole.MANAGER) {
        await this.assertNotLastManager(organizationId, member, tx);
      }
      const account = await this.accounts.setOrganizationRole(
        member.userId,
        ORGANIZATION_ROLE[role],
        tx,
        caller.id,
      );
      const saved = await this.members.setRole(member.id, role, tx);
      this.audit(
        caller,
        organizationId,
        'member.roleChanged',
        { memberId, role: member.role },
        { memberId, role },
      );
      return toView(saved, account);
    });
  }

  // api-design 15: the account and its sessions end at once, the member leaves every shift that has
  // not ended, and `member.deactivated` is emitted after commit (REQ-EVT-07, REQ-EVT-08, FR-AUTH-07).
  // The member cannot return: no endpoint reactivates one, and the email stays registered.
  async deactivate(
    organizationId: string,
    memberId: string,
    reason: string | undefined,
    caller: Caller,
    at: Date = new Date(),
  ): Promise<MemberView> {
    this.assertOwn(organizationId, caller);
    return this.events.transaction(async (tx) => {
      await this.lockManageable(organizationId, tx);
      const member = await this.liveMember(organizationId, memberId, tx);
      if (member.role === MemberRole.MANAGER) {
        await this.assertNotLastManager(organizationId, member, tx);
      }
      const account = await this.accounts.deactivateOrganizationAccount(
        member.userId,
        reason ?? 'Deactivated by a Manager',
        caller,
        tx,
        at,
      );
      const saved = await this.members.markDeactivated(member.id, at, tx);
      await this.roster.clearMember(member.id, at, tx);
      this.events.emitAfterCommit(MEMBER_DEACTIVATED, { userId: member.userId });
      this.audit(
        caller,
        organizationId,
        'member.deactivated',
        { memberId, role: member.role, deactivatedAt: null },
        { memberId, deactivatedAt: at, reason: reason ?? null },
      );
      return toView(saved, account);
    });
  }

  // A Manager manages their own organization only; another organization answers 404, as it does for
  // every read of the module.
  private assertOwn(organizationId: string, caller: Caller): void {
    if (caller.organizationId !== organizationId) throw notFound('Organization');
  }

  // Locks the organization row, which serialises every change to its members, and refuses a status
  // that does not allow them (MSG28).
  private async lockManageable(
    organizationId: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const organization = await this.organizations.lockById(organizationId, tx);
    if (!organization) throw notFound('Organization');
    if (!MANAGEABLE.has(organization.status)) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        ErrorCode.INVALID_STATE_TRANSITION,
        `This cannot be done while it is ${organization.status}.`,
      );
    }
  }

  private async liveMember(
    organizationId: string,
    memberId: string,
    tx: Prisma.TransactionClient,
  ): Promise<MemberRow> {
    const member = await this.members.findInOrganization(organizationId, memberId, tx);
    if (!member || member.deactivatedAt !== null) throw notFound('Member');
    return member;
  }

  // Only a Manager who has set their password counts as an active Manager, since a pending invitation
  // cannot sign in. Taking an active Manager away is refused when no other active Manager remains.
  private async assertNotLastManager(
    organizationId: string,
    target: MemberRow,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const managerIds = await this.members.liveManagerUserIds(organizationId, tx);
    const cards = await this.accounts.contactCard(managerIds);
    const canSignIn = (card: ContactCard) => card.isActive && card.passwordSet;
    const targetIsActive = cards.some((card) => card.id === target.userId && canSignIn(card));
    const othersActive = cards.filter((card) => card.id !== target.userId && canSignIn(card));
    if (targetIsActive && othersActive.length === 0) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        ErrorCode.LAST_MANAGER,
        'The organization must keep at least one Manager.',
      );
    }
  }

  private async view(member: MemberRow): Promise<MemberView> {
    const [card] = await this.accounts.contactCard([member.userId]);
    return toView(
      member,
      card ? { email: card.email, fullName: card.fullName, passwordSet: card.passwordSet } : null,
    );
  }

  private audit(
    actor: Caller,
    organizationId: string,
    action: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown>,
  ): void {
    this.events.emitAfterCommit(AUDIT_RECORD, {
      actorId: actor.id,
      actorRoles: actor.roles,
      organizationId,
      action,
      subjectType: 'Member',
      subjectId: String(after.memberId),
      before,
      after,
    } satisfies AuditRecordEvent);
  }
}

const toView = (
  member: MemberRow,
  account: { email: string; fullName: string; passwordSet: boolean } | null,
): MemberView => ({
  id: member.id,
  userId: member.userId,
  email: account?.email ?? null,
  fullName: account?.fullName ?? null,
  role: member.role,
  // An invited account is created active; it waits for its password until the code is used.
  invitationPending: account ? !account.passwordSet && member.deactivatedAt === null : false,
  deactivatedAt: member.deactivatedAt,
});
