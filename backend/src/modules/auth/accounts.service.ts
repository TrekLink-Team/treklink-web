import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import { AccountsRepository, AccountView } from './accounts.repository';
import { OneTimeCodeService } from './one-time-code.service';
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
