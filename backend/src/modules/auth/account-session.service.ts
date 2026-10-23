import { Inject, Injectable, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AccountType } from '@prisma/client';
import { Account, AccountsRepository } from './accounts.repository';
import {
  ACCOUNT_CONTEXT_PROVIDER,
  AccountContextProvider,
  AccountMembership,
  MemberRole,
} from './ports/account-context.port';

// Emitted by `organizations` when a member is deactivated (specs/auth/design.md §2).
export const MEMBER_DEACTIVATED = 'member.deactivated';

export interface MemberDeactivatedEvent {
  userId: string;
}

// The signed-in account as sign-in, refresh, the JWT strategy and GET /api/auth/me see it.
export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  accountType: AccountType;
  roles: string[];
  organization: {
    id: string;
    code: string;
    legalName: string;
    status: string;
    memberRole: MemberRole;
  } | null;
}

// Members of these organizations may neither sign in nor refresh (REQ-STA-03).
const BLOCKED_ORGANIZATION_STATUSES: ReadonlySet<string> = new Set(['CLOSED', 'REJECTED']);
const MEMBERSHIP_CACHE_MS = 30_000;

interface CachedMembership {
  value: AccountMembership | null;
  expiresAt: number;
}

// Decides whether an account may hold a session and builds its SessionUser (REQ-STA-02,
// REQ-STA-03, REQ-EVT-07). Membership comes from ACCOUNT_CONTEXT_PROVIDER, cached 30 s and
// invalidated by member.deactivated. Until `organizations` provides the port (task 1.3), an
// ORGANIZATION account has no membership and is refused, as the port contract reads null.
@Injectable()
export class AccountSessionService {
  private readonly memberships = new Map<string, CachedMembership>();

  constructor(
    private readonly accounts: AccountsRepository,
    @Optional()
    @Inject(ACCOUNT_CONTEXT_PROVIDER)
    private readonly accountContext?: AccountContextProvider,
  ) {}

  async load(userId: string): Promise<SessionUser | null> {
    const account = await this.accounts.findById(userId);
    return account ? this.eligible(account) : null;
  }

  // null when the account is inactive, deleted, has no password yet, or is a member with no
  // membership or of a CLOSED or REJECTED organization.
  async eligible(account: Account): Promise<SessionUser | null> {
    if (!account.isActive || account.deletedAt || !account.passwordHash) return null;

    let organization: SessionUser['organization'] = null;
    if (account.accountType === AccountType.ORGANIZATION) {
      const membership = await this.membership(account.id);
      if (!membership || BLOCKED_ORGANIZATION_STATUSES.has(membership.organizationStatus)) {
        return null;
      }
      organization = {
        id: membership.organizationId,
        code: membership.organizationCode,
        legalName: membership.legalName,
        status: membership.organizationStatus,
        memberRole: membership.memberRole,
      };
    }

    return {
      id: account.id,
      email: account.email,
      fullName: account.fullName,
      accountType: account.accountType,
      roles: account.roles,
      organization,
    };
  }

  @OnEvent(MEMBER_DEACTIVATED)
  forgetMembership(event: MemberDeactivatedEvent): void {
    this.memberships.delete(event.userId);
  }

  private async membership(userId: string): Promise<AccountMembership | null> {
    if (!this.accountContext) return null;

    const now = Date.now();
    const cached = this.memberships.get(userId);
    if (cached && cached.expiresAt > now) return cached.value;

    const value = await this.accountContext.forUser(userId);
    this.memberships.set(userId, { value, expiresAt: now + MEMBERSHIP_CACHE_MS });
    return value;
  }
}
