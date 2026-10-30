import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { AccountType, AuthEventType, OtpPurpose, Prisma } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import {
  PagedQueryDto,
  PagedResult,
  pagingBoundsFrom,
  resolvePage,
  toPagedResult,
} from '../../common/dto/paging';
import { DomainException, ErrorCode } from '../../common/errors';
import { AUDIT_RECORD, AuditRecordEvent } from '../platform/audit/audit-record.event';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { Account, AccountsRepository, AccountView, ContactCard } from './accounts.repository';
import { IssuedCode, OneTimeCodeService } from './one-time-code.service';
import { PasswordFlowsService } from './password-flows.service';
import { ClientInfo } from './token.service';

export const TREKLINK_ROLES = ['STAFF', 'ADMIN'] as const;
export type TreklinkRole = (typeof TREKLINK_ROLES)[number];

export interface AccountListQuery extends PagedQueryDto {
  q?: string;
  isActive?: boolean;
}

export interface NewTreklinkAccount {
  email: string;
  fullName: string;
  role: TreklinkRole;
}

export interface AccountChange {
  fullName?: string;
  phoneNumber?: string;
  role?: TreklinkRole;
}

export const ORGANIZATION_ROLES = ['ORG_MANAGER', 'ORG_OPERATOR'] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

// A member invited by its Manager, or the Manager who registers the organization (design §5).
// `createdById` is the inviting account, or null for a Guest registration.
export interface NewOrganizationAccount {
  email: string;
  fullName: string;
  phone?: string | null;
  role: OrganizationRole;
  createdById?: string | null;
}

// An account as `organizations` sees it after creating or changing it; never the password hash.
export interface OrganizationAccount {
  id: string;
  email: string;
  fullName: string;
  isActive: boolean;
  // False while the invitation's set-password code is unused: the account cannot sign in yet.
  passwordSet: boolean;
  roles: string[];
}

// Internal to `auth`: the invitation of a new organization account, sent once the caller's
// transaction has committed. The payload carries the code, so no other module listens to it.
export const ORGANIZATION_INVITATION_ISSUED = 'auth.organizationInvitationIssued';

interface OrganizationInvitationIssued {
  userId: string;
  email: string;
  issued: IssuedCode;
}

const toOrganizationAccount = (account: Account): OrganizationAccount => ({
  id: account.id,
  email: account.email,
  fullName: account.fullName,
  isActive: account.isActive,
  passwordSet: account.passwordHash !== null,
  roles: account.roles,
});

const notFound = () =>
  new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Account not found.');

const lastAdmin = () =>
  new DomainException(
    HttpStatus.CONFLICT,
    ErrorCode.LAST_ADMIN,
    'At least one Admin must stay active.',
  );

const isAdmin = (account: AccountView) => account.roles.includes('ADMIN');

// TrekLink Staff and Admin accounts (auth task 5.1, api-design 09 to 13, UC-10). Organization
// accounts are managed through `organizations`, so they are not found here (treklink-docs#98, 5).
// Nothing is hard-deleted (FR-AUTH-09). Every change that can lower the number of active Admins
// runs under one advisory lock, so two concurrent changes cannot both pass the last-Admin check.
@Injectable()
export class AccountsService {
  constructor(
    private readonly accounts: AccountsRepository,
    private readonly codes: OneTimeCodeService,
    private readonly passwords: PasswordFlowsService,
    private readonly events: TransactionalEvents,
    private readonly config: ConfigService<ValidatedEnvironment, true>,
  ) {}

  async list(query: AccountListQuery): Promise<PagedResult<AccountView>> {
    const page = resolvePage(
      query,
      pagingBoundsFrom({
        DEFAULT_PAGE_SIZE: this.config.get('DEFAULT_PAGE_SIZE', { infer: true }),
        MAX_PAGE_SIZE: this.config.get('MAX_PAGE_SIZE', { infer: true }),
      }),
    );
    const [items, total] = await this.accounts.pageTreklinkAccounts(
      { q: query.q, isActive: query.isActive },
      page.skip,
      page.take,
    );
    return toPagedResult(items, total, page);
  }

  // api-design 10: no password until the invitation code is used (REQ-EVT-06, BR-35). The email is
  // sent after the commit, and the answer does not wait for it.
  async create(actor: Caller, input: NewTreklinkAccount, client: ClientInfo): Promise<AccountView> {
    const now = new Date();
    const { account, issued } = await this.events.transaction(async (tx) => {
      const created = await this.accounts.create(
        {
          email: input.email,
          fullName: input.fullName,
          accountType: AccountType.TREKLINK,
          roleKeys: [input.role],
          createdById: actor.id,
        },
        tx,
      );
      const code = await this.codes.issue(created.id, OtpPurpose.SET_PASSWORD, now, tx);
      const view = (await this.accounts.findTreklinkAccount(created.id, tx))!;
      this.audit(actor, 'account.create', view.id, client, undefined, {
        email: view.email,
        role: input.role,
      });
      return { account: view, issued: code };
    });
    void this.passwords.sendCode(account, OtpPurpose.SET_PASSWORD, issued);
    return account;
  }

  // api-design 11. A role change applies on the next request, because the JWT strategy reads the
  // roles from the database (FR-AUTH-06).
  async update(
    actor: Caller,
    id: string,
    change: AccountChange,
    client: ClientInfo,
  ): Promise<AccountView> {
    return this.events.transaction(async (tx) => {
      if (change.role) await this.accounts.lockAdminChanges(tx);
      const before = await this.accounts.findTreklinkAccount(id, tx);
      if (!before) throw notFound();

      if (change.role && !before.roles.includes(change.role)) {
        if (isAdmin(before)) await this.assertCanLoseAdmin(actor, before, tx);
        await this.accounts.replaceRole(id, change.role, actor.id, tx);
      }
      const profile = {
        ...(change.fullName === undefined ? {} : { fullName: change.fullName }),
        ...(change.phoneNumber === undefined ? {} : { phoneNumber: change.phoneNumber }),
      };
      if (Object.keys(profile).length > 0) await this.accounts.updateProfile(id, profile, tx);

      const after = (await this.accounts.findTreklinkAccount(id, tx))!;
      this.audit(actor, 'account.update', id, client, snapshot(before), snapshot(after));
      return after;
    });
  }

  // api-design 12: the account and its sessions end at once (FR-AUTH-07, REQ-EVT-07). Deactivating
  // an inactive account changes nothing (treklink-docs#98, 3).
  async deactivate(
    actor: Caller,
    id: string,
    reason: string,
    client: ClientInfo,
  ): Promise<AccountView> {
    const now = new Date();
    return this.events.transaction(async (tx) => {
      await this.accounts.lockAdminChanges(tx);
      const account = await this.accounts.findTreklinkAccount(id, tx);
      if (!account) throw notFound();
      if (!account.isActive) return account;
      if (isAdmin(account) && (await this.accounts.countActiveAdmins(tx)) <= 1) throw lastAdmin();

      await this.accounts.setActive(id, false, tx);
      await this.accounts.revokeAllUserTokens(id, now, tx);
      await this.accounts.insertAuthEvent(
        {
          userId: id,
          email: account.email,
          type: AuthEventType.ACCOUNT_DEACTIVATED,
          ...client,
        },
        tx,
      );
      this.audit(
        actor,
        'account.deactivate',
        id,
        client,
        { isActive: true },
        {
          isActive: false,
          reason,
        },
      );
      return { ...account, isActive: false };
    });
  }

  // api-design 13. Reactivating an active account changes nothing (treklink-docs#98, 3).
  async reactivate(actor: Caller, id: string, client: ClientInfo): Promise<AccountView> {
    return this.events.transaction(async (tx) => {
      const account = await this.accounts.findTreklinkAccount(id, tx);
      if (!account) throw notFound();
      if (account.isActive) return account;

      await this.accounts.setActive(id, true, tx);
      await this.accounts.insertAuthEvent(
        {
          userId: id,
          email: account.email,
          type: AuthEventType.ACCOUNT_REACTIVATED,
          ...client,
        },
        tx,
      );
      this.audit(actor, 'account.reactivate', id, client, { isActive: false }, { isActive: true });
      return { ...account, isActive: true };
    });
  }

  // Services `organizations` and `incidents` call (auth task 5.2, design §5). They take the caller's
  // transaction; `organizations` opens it with TransactionalEvents.transaction, so the invitation of
  // createOrganizationAccount is sent only after it commits. The membership, the last-Manager rule
  // and `member.deactivated` stay with `organizations`.

  // A new organization account without a password and a SET_PASSWORD code (REQ-EVT-06, FR-ORG-02).
  // An email already registered is 409 CONFLICT_UNIQUE; a role outside the organization roles 400.
  async createOrganizationAccount(
    input: NewOrganizationAccount,
    tx: Prisma.TransactionClient,
    now: Date = new Date(),
  ): Promise<OrganizationAccount> {
    const created = await this.accounts.create(
      {
        email: input.email,
        fullName: input.fullName,
        phoneNumber: input.phone ?? null,
        accountType: AccountType.ORGANIZATION,
        roleKeys: [input.role],
        createdById: input.createdById ?? null,
      },
      tx,
    );
    const issued = await this.codes.issue(created.id, OtpPurpose.SET_PASSWORD, now, tx);
    this.events.emitAfterCommit(ORGANIZATION_INVITATION_ISSUED, {
      userId: created.id,
      email: created.email,
      issued,
    } satisfies OrganizationInvitationIssued);
    return toOrganizationAccount(created);
  }

  @OnEvent(ORGANIZATION_INVITATION_ISSUED)
  sendOrganizationInvitation(event: OrganizationInvitationIssued): Promise<void> {
    return this.passwords.sendCode(
      { id: event.userId, email: event.email },
      OtpPurpose.SET_PASSWORD,
      event.issued,
    );
  }

  // A Manager changes a member's role; it applies on the member's next request (FR-AUTH-06).
  // `actorId` records who granted it, or null.
  async setOrganizationRole(
    userId: string,
    role: OrganizationRole,
    tx: Prisma.TransactionClient,
    actorId: string | null = null,
  ): Promise<OrganizationAccount> {
    const account = await this.organizationAccount(userId, tx);
    if (!account.roles.includes(role)) await this.accounts.replaceRole(userId, role, actorId, tx);
    return { ...toOrganizationAccount(account), roles: [role] };
  }

  // Member deactivation and organization closing: the account and its sessions end at once
  // (FR-AUTH-07, REQ-EVT-07, REQ-UBI-08). An inactive account changes nothing. Named apart from
  // `deactivate`, the TrekLink route of api-design 12.
  async deactivateOrganizationAccount(
    userId: string,
    reason: string,
    actor: Caller | null,
    tx: Prisma.TransactionClient,
    now: Date = new Date(),
  ): Promise<OrganizationAccount> {
    const account = await this.organizationAccount(userId, tx);
    if (!account.isActive) return toOrganizationAccount(account);

    await this.accounts.setActive(userId, false, tx);
    await this.accounts.revokeAllUserTokens(userId, now, tx);
    await this.accounts.insertAuthEvent(
      {
        userId,
        email: account.email,
        type: AuthEventType.ACCOUNT_DEACTIVATED,
        ip: null,
        userAgent: null,
      },
      tx,
    );
    this.events.emitAfterCommit(AUDIT_RECORD, {
      actorId: actor?.id ?? null,
      actorRoles: actor?.roles ?? [],
      organizationId: actor?.organizationId ?? null,
      action: 'account.deactivate',
      subjectType: 'Account',
      subjectId: userId,
      before: { isActive: true },
      after: { isActive: false, reason },
    } satisfies AuditRecordEvent);
    return { ...toOrganizationAccount(account), isActive: false };
  }

  // Name, email and phone for alert delivery (`incidents`).
  contactCard(userIds: readonly string[]): Promise<ContactCard[]> {
    return userIds.length === 0 ? Promise.resolve([]) : this.accounts.contactCards(userIds);
  }

  // Ids of the active TrekLink Staff and Admin accounts, read by `incidents` when an incident reaches
  // ESCALATED (D-079, platform design Figure 3 `incidents --> auth`). Joins the caller's transaction.
  activeStaffAndAdminIds(tx?: Prisma.TransactionClient): Promise<string[]> {
    return this.accounts.activeStaffAndAdminIds(tx);
  }

  // An organization account, or 404 for an unknown id or a TrekLink account.
  private async organizationAccount(
    userId: string,
    tx: Prisma.TransactionClient,
  ): Promise<Account> {
    const account = await this.accounts.findById(userId, tx);
    if (!account || account.accountType !== AccountType.ORGANIZATION || account.deletedAt) {
      throw notFound();
    }
    return account;
  }

  // An Admin cannot drop their own Admin role (SELF_DEMOTION), and the last active Admin keeps it
  // (LAST_ADMIN). The caller holds the advisory lock.
  private async assertCanLoseAdmin(
    actor: Caller,
    account: AccountView,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    if (account.id === actor.id) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        ErrorCode.SELF_DEMOTION,
        'You cannot remove your own Admin role.',
      );
    }
    if (account.isActive && (await this.accounts.countActiveAdmins(tx)) <= 1) throw lastAdmin();
  }

  private audit(
    actor: Caller,
    action: string,
    subjectId: string,
    client: ClientInfo,
    before: unknown,
    after: unknown,
  ): void {
    this.events.emitAfterCommit(AUDIT_RECORD, {
      actorId: actor.id,
      actorRoles: actor.roles,
      organizationId: null,
      action,
      subjectType: 'Account',
      subjectId,
      before,
      after,
      ip: client.ip,
    } satisfies AuditRecordEvent);
  }
}

const snapshot = (account: AccountView) => ({
  fullName: account.fullName,
  phoneNumber: account.phoneNumber,
  roles: account.roles,
});
