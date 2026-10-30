import { HttpStatus, Injectable } from '@nestjs/common';
import { AccountType, AuthEventType, OtpPurpose, Prisma } from '@prisma/client';
import { DomainException, ErrorCode } from '../../common/errors';
import { PrismaService } from '../../common/prisma/prisma.service';

type Client = Prisma.TransactionClient | PrismaService;

// The account fields sign-in, refresh and the JWT strategy need (specs/auth/design.md §1).
export const ACCOUNT_SELECT = {
  id: true,
  email: true,
  fullName: true,
  accountType: true,
  isActive: true,
  deletedAt: true,
  passwordHash: true,
  lockedUntil: true,
  lastLoginAt: true,
  roles: { select: { role: { select: { key: true } } } },
} satisfies Prisma.UserSelect;

type AccountRow = Prisma.UserGetPayload<{ select: typeof ACCOUNT_SELECT }>;

export interface Account extends Omit<AccountRow, 'roles'> {
  roles: string[];
}

export interface NewAccount {
  email: string;
  fullName: string;
  phoneNumber?: string | null;
  accountType: AccountType;
  roleKeys: string[];
  createdById?: string | null;
}

export interface AuthEventInput {
  userId: string | null;
  email: string | null;
  type: AuthEventType;
  ip: string | null;
  userAgent: string | null;
}

export interface AuthEventRow {
  id: string;
  userId: string | null;
  email: string | null;
  type: AuthEventType;
  ip: string | null;
  createdAt: Date;
}

export interface NewRefreshToken {
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  ip: string | null;
  userAgent: string | null;
}

// The account as the Admin screens show it (api-design 09 to 13).
export const ACCOUNT_VIEW_SELECT = {
  id: true,
  email: true,
  fullName: true,
  phoneNumber: true,
  accountType: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  roles: { select: { role: { select: { key: true } } } },
} satisfies Prisma.UserSelect;

type AccountViewRow = Prisma.UserGetPayload<{ select: typeof ACCOUNT_VIEW_SELECT }>;

export interface AccountView extends Omit<AccountViewRow, 'roles'> {
  roles: string[];
}

const toAccountView = (row: AccountViewRow): AccountView => ({
  ...row,
  roles: row.roles.map((grant) => grant.role.key),
});

const ROLE_VIEW_SELECT = {
  id: true,
  key: true,
  accountType: true,
  isSystem: true,
  permissions: { select: { permission: { select: { key: true } } } },
} satisfies Prisma.RoleSelect;

type RoleViewRow = Prisma.RoleGetPayload<{ select: typeof ROLE_VIEW_SELECT }>;

export interface RoleView extends Omit<RoleViewRow, 'permissions'> {
  permissionKeys: string[];
}

const toRoleView = ({ permissions, ...role }: RoleViewRow): RoleView => ({
  ...role,
  permissionKeys: permissions.map((grant) => grant.permission.key).sort(),
});

export const CATALOG_PERMISSION_SELECT = {
  id: true,
  key: true,
  action: true,
  subject: true,
  accountType: true,
  conditions: true,
} satisfies Prisma.PermissionSelect;

export type CatalogPermissionRow = Prisma.PermissionGetPayload<{
  select: typeof CATALOG_PERMISSION_SELECT;
}>;

// pg_advisory_xact_lock key of the last-Admin guard, named as incidents names its code lock.
export const ADMIN_CHANGES_LOCK = 'auth:active-admins';

export interface NewOneTimeCode {
  userId: string;
  purpose: OtpPurpose;
  codeHash: string;
  expiresAt: Date;
}

export const ONE_TIME_CODE_SELECT = {
  id: true,
  codeHash: true,
  attempts: true,
  expiresAt: true,
} satisfies Prisma.OneTimeCodeSelect;

export type OneTimeCodeRow = Prisma.OneTimeCodeGetPayload<{
  select: typeof ONE_TIME_CODE_SELECT;
}>;

export const REFRESH_TOKEN_SELECT = {
  id: true,
  userId: true,
  familyId: true,
  expiresAt: true,
  revokedAt: true,
  replacedById: true,
} satisfies Prisma.RefreshTokenSelect;

export type RefreshTokenRow = Prisma.RefreshTokenGetPayload<{
  select: typeof REFRESH_TOKEN_SELECT;
}>;

// A permission row as the CASL ability factory reads it (auth task 4.1).
export const PERMISSION_RULE_SELECT = {
  key: true,
  action: true,
  subject: true,
  conditions: true,
  fields: true,
  inverted: true,
  reason: true,
} satisfies Prisma.PermissionSelect;

export type PermissionRuleRow = Prisma.PermissionGetPayload<{
  select: typeof PERMISSION_RULE_SELECT;
}>;

// What another module may know of an account to reach its holder (auth task 5.2, design §5).
export const CONTACT_CARD_SELECT = {
  id: true,
  fullName: true,
  email: true,
  phoneNumber: true,
  isActive: true,
} satisfies Prisma.UserSelect;

// `passwordSet` tells an invitation still waiting for its password apart from an account in use; the
// hash itself never leaves `auth`.
export type ContactCard = Prisma.UserGetPayload<{ select: typeof CONTACT_CARD_SELECT }> & {
  passwordSet: boolean;
};

// Emails are stored lower-case and compared case-insensitively (REQ-UBI-01).
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const toAccount = (row: AccountRow): Account => ({
  ...row,
  roles: row.roles.map((grant) => grant.role.key),
});

// The only class of `auth` that touches Prisma (D-044 rule 4). Models: User, Role, UserRole,
// RefreshToken, OneTimeCode, AuthEvent (auth task 1.4).
@Injectable()
export class AccountsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Includes inactive and soft-deleted rows; the caller decides what they may do.
  async findByEmail(email: string, client: Client = this.prisma): Promise<Account | null> {
    const row = await client.user.findUnique({
      where: { email: normalizeEmail(email) },
      select: ACCOUNT_SELECT,
    });
    return row ? toAccount(row) : null;
  }

  async findById(id: string, client: Client = this.prisma): Promise<Account | null> {
    const row = await client.user.findUnique({ where: { id }, select: ACCOUNT_SELECT });
    return row ? toAccount(row) : null;
  }

  // Creates an account without a password (REQ-EVT-06). Uniqueness covers inactive and
  // soft-deleted accounts (REQ-UBI-01); each role must belong to the account type (REQ-UBI-03).
  async create(input: NewAccount, client: Client = this.prisma): Promise<Account> {
    const email = normalizeEmail(input.email);
    const taken = await client.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true },
    });
    if (taken) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        ErrorCode.CONFLICT_UNIQUE,
        `${email} is already registered.`,
      );
    }

    const roles = await client.role.findMany({
      where: { key: { in: input.roleKeys } },
      select: { id: true, key: true, accountType: true },
    });
    const granted = input.roleKeys.map((key) => {
      const role = roles.find((candidate) => candidate.key === key);
      if (!role || role.accountType !== input.accountType) {
        throw new DomainException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_FAILED,
          `Role ${key} cannot be held by a ${input.accountType} account.`,
        );
      }
      return role;
    });

    const row = await client.user.create({
      data: {
        email,
        fullName: input.fullName,
        phoneNumber: input.phoneNumber ?? null,
        accountType: input.accountType,
        createdById: input.createdById ?? null,
        roles: {
          create: granted.map((role) => ({
            roleId: role.id,
            grantedById: input.createdById ?? null,
          })),
        },
      },
      select: ACCOUNT_SELECT,
    });
    return toAccount(row);
  }

  countLoginFailuresSince(
    userId: string,
    since: Date,
    client: Client = this.prisma,
  ): Promise<number> {
    return client.authEvent.count({
      where: { userId, type: AuthEventType.LOGIN_FAILED, createdAt: { gt: since } },
    });
  }

  async recordLoginFailure(
    userId: string,
    failedLoginCount: number,
    lockedUntil: Date | null,
    client: Client = this.prisma,
  ): Promise<void> {
    await client.user.update({
      where: { id: userId },
      data: { failedLoginCount, ...(lockedUntil ? { lockedUntil } : {}) },
    });
  }

  async recordLoginSuccess(userId: string, at: Date, client: Client = this.prisma): Promise<void> {
    await client.user.update({
      where: { id: userId },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: at },
    });
  }

  // The authentication log, newest first (api-design 17).
  pageAuthEvents(
    where: Prisma.AuthEventWhereInput,
    skip: number,
    take: number,
  ): Promise<[AuthEventRow[], number]> {
    return Promise.all([
      this.prisma.authEvent.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip,
        take,
        select: { id: true, userId: true, email: true, type: true, ip: true, createdAt: true },
      }),
      this.prisma.authEvent.count({ where }),
    ]);
  }

  // Append-only (trigger). Never receives an attempted password (REQ-UBI-08).
  async insertAuthEvent(event: AuthEventInput, client: Client = this.prisma): Promise<void> {
    await client.authEvent.create({ data: event });
  }

  createRefreshToken(
    token: NewRefreshToken,
    client: Client = this.prisma,
  ): Promise<{ id: string }> {
    return client.refreshToken.create({ data: token, select: { id: true } });
  }

  findRefreshTokenByHash(
    tokenHash: string,
    client: Client = this.prisma,
  ): Promise<RefreshTokenRow | null> {
    return client.refreshToken.findUnique({ where: { tokenHash }, select: REFRESH_TOKEN_SELECT });
  }

  // Compare-and-set: revokes the token only if it is still live, so two concurrent rotations of
  // one token cannot both succeed. Returns whether this call revoked it.
  async revokeIfLive(
    id: string,
    at: Date,
    replacedById: string | null,
    client: Client = this.prisma,
  ): Promise<boolean> {
    const { count } = await client.refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: at, replacedById },
    });
    return count === 1;
  }

  async revokeFamily(
    userId: string,
    familyId: string,
    at: Date,
    client: Client = this.prisma,
  ): Promise<void> {
    await client.refreshToken.updateMany({
      where: { userId, familyId, revokedAt: null },
      data: { revokedAt: at },
    });
  }

  async revokeUserToken(
    userId: string,
    tokenHash: string,
    at: Date,
    client: Client = this.prisma,
  ): Promise<boolean> {
    const { count } = await client.refreshToken.updateMany({
      where: { userId, tokenHash, revokedAt: null },
      data: { revokedAt: at },
    });
    return count === 1;
  }

  // Every live refresh token of the account, after a password reset or change (REQ-EVT-05).
  async revokeAllUserTokens(userId: string, at: Date, client: Client = this.prisma): Promise<void> {
    await client.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: at },
    });
  }

  async setPasswordHash(
    userId: string,
    passwordHash: string,
    client: Client = this.prisma,
  ): Promise<void> {
    await client.user.update({ where: { id: userId }, data: { passwordHash } });
  }

  // When the account was last sent a code of any purpose, for the resend cooldown (REQ-ERR-08).
  async lastCodeSentAt(userId: string, client: Client = this.prisma): Promise<Date | null> {
    const row = await client.oneTimeCode.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return row?.createdAt ?? null;
  }

  // Spends the account's live codes of a purpose, so only the code sent next works.
  async consumeLiveCodes(
    userId: string,
    purpose: OtpPurpose,
    at: Date,
    client: Client = this.prisma,
  ): Promise<void> {
    await client.oneTimeCode.updateMany({
      where: { userId, purpose, consumedAt: null },
      data: { consumedAt: at },
    });
  }

  async createCode(code: NewOneTimeCode, client: Client = this.prisma): Promise<void> {
    await client.oneTimeCode.create({ data: code });
  }

  // The newest code of a purpose that is not consumed; expiry and attempts are the caller's check.
  findLiveCode(
    userId: string,
    purpose: OtpPurpose,
    client: Client = this.prisma,
  ): Promise<OneTimeCodeRow | null> {
    return client.oneTimeCode.findFirst({
      where: { userId, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
      select: ONE_TIME_CODE_SELECT,
    });
  }

  // Counts one attempt on a code that is live, unexpired and under the limit, in one statement, and
  // reports whether it did. Concurrent callers each see the count the database holds (REQ-ERR-03).
  async spendAttempt(
    id: string,
    maxAttempts: number,
    now: Date,
    client: Client = this.prisma,
  ): Promise<boolean> {
    const { count } = await client.oneTimeCode.updateMany({
      where: { id, consumedAt: null, expiresAt: { gt: now }, attempts: { lt: maxAttempts } },
      data: { attempts: { increment: 1 } },
    });
    return count === 1;
  }

  // Compare-and-set, so one code cannot be used by two concurrent requests.
  async consumeCode(id: string, at: Date, client: Client = this.prisma): Promise<boolean> {
    const { count } = await client.oneTimeCode.updateMany({
      where: { id, consumedAt: null },
      data: { consumedAt: at },
    });
    return count === 1;
  }

  // The permissions granted to the role with this key; an unknown key grants nothing (auth task 4.1).
  async findRolePermissions(roleKey: string): Promise<PermissionRuleRow[]> {
    const grants = await this.prisma.rolePermission.findMany({
      where: { role: { key: roleKey } },
      select: { permission: { select: PERMISSION_RULE_SELECT } },
    });
    return grants.map((grant) => grant.permission);
  }

  // The permission rows with these keys, for the fixed ability of an API key (auth task 4.3).
  findPermissionRules(keys: readonly string[]): Promise<PermissionRuleRow[]> {
    return this.prisma.permission.findMany({
      where: { key: { in: [...keys] } },
      orderBy: { key: 'asc' },
      select: PERMISSION_RULE_SELECT,
    });
  }

  // TrekLink accounts for the Admin list, newest first; soft-deleted rows are not listed (api-design
  // 09). `q` matches the name or the email, case-insensitively.
  async pageTreklinkAccounts(
    filter: { q?: string; isActive?: boolean },
    skip: number,
    take: number,
  ): Promise<[AccountView[], number]> {
    const where: Prisma.UserWhereInput = {
      accountType: AccountType.TREKLINK,
      deletedAt: null,
      ...(filter.isActive === undefined ? {} : { isActive: filter.isActive }),
      ...(filter.q
        ? {
            OR: [
              { fullName: { contains: filter.q, mode: 'insensitive' } },
              { email: { contains: filter.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip,
        take,
        select: ACCOUNT_VIEW_SELECT,
      }),
      this.prisma.user.count({ where }),
    ]);
    return [rows.map(toAccountView), total];
  }

  // A TrekLink account that is not deleted; organization accounts belong to `organizations`.
  async findTreklinkAccount(id: string, client: Client = this.prisma): Promise<AccountView | null> {
    const row = await client.user.findFirst({
      where: { id, accountType: AccountType.TREKLINK, deletedAt: null },
      select: ACCOUNT_VIEW_SELECT,
    });
    return row ? toAccountView(row) : null;
  }

  async updateProfile(
    id: string,
    profile: { fullName?: string; phoneNumber?: string },
    client: Client = this.prisma,
  ): Promise<void> {
    await client.user.update({ where: { id }, data: profile });
  }

  async setActive(id: string, isActive: boolean, client: Client = this.prisma): Promise<void> {
    await client.user.update({ where: { id }, data: { isActive } });
  }

  // An account holds one role: STAFF or ADMIN for TrekLink, ORG_MANAGER or ORG_OPERATOR for an
  // organization; Admin and Manager inherit the other (FR-AUTH-10). `grantedById` is null when no
  // TrekLink actor is known, as for a change `organizations` makes for its Manager.
  async replaceRole(
    userId: string,
    roleKey: string,
    grantedById: string | null,
    client: Client = this.prisma,
  ): Promise<void> {
    const role = await client.role.findUniqueOrThrow({
      where: { key: roleKey },
      select: { id: true },
    });
    await client.userRole.deleteMany({ where: { userId } });
    await client.userRole.create({ data: { userId, roleId: role.id, grantedById } });
  }

  // Serializes every change that can lower the number of active Admins, inside the caller's
  // transaction, so two concurrent changes cannot both see a second Admin (auth task 5.1).
  async lockAdminChanges(tx: Prisma.TransactionClient): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ADMIN_CHANGES_LOCK}))`;
  }

  countActiveAdmins(client: Client = this.prisma): Promise<number> {
    return client.user.count({
      where: { isActive: true, deletedAt: null, roles: { some: { role: { key: 'ADMIN' } } } },
    });
  }

  // Ids of the active TrekLink Staff accounts, the Staff recipients of an ESCALATED incident (D-079).
  async activeStaffIds(client: Client = this.prisma): Promise<string[]> {
    const rows = await client.user.findMany({
      where: {
        accountType: AccountType.TREKLINK,
        isActive: true,
        deletedAt: null,
        roles: { some: { role: { key: 'STAFF' } } },
      },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  // The four system roles with the keys of their permissions (api-design 15).
  async listRoles(): Promise<RoleView[]> {
    const rows = await this.prisma.role.findMany({
      orderBy: { key: 'asc' },
      select: ROLE_VIEW_SELECT,
    });
    return rows.map(toRoleView);
  }

  async findRole(id: string, client: Client = this.prisma): Promise<RoleView | null> {
    const row = await client.role.findUnique({ where: { id }, select: ROLE_VIEW_SELECT });
    return row ? toRoleView(row) : null;
  }

  // The seeded permission catalog (api-design 18), or the rows of the given keys.
  listPermissions(
    keys?: readonly string[],
    client: Client = this.prisma,
  ): Promise<CatalogPermissionRow[]> {
    return client.permission.findMany({
      where: keys ? { key: { in: [...keys] } } : {},
      orderBy: { key: 'asc' },
      select: CATALOG_PERMISSION_SELECT,
    });
  }

  async replaceRolePermissions(
    roleId: string,
    permissionIds: readonly string[],
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.rolePermission.deleteMany({ where: { roleId } });
    await tx.rolePermission.createMany({
      data: permissionIds.map((permissionId) => ({ roleId, permissionId })),
    });
  }

  // Full names for display (the ACCOUNT_DIRECTORY port of platform). Includes inactive and
  // soft-deleted accounts, so an old row keeps its actor (REQ-UBI-07).
  async namesOf(
    ids: readonly string[],
    client: Client = this.prisma,
  ): Promise<Map<string, string>> {
    const rows = await client.user.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, fullName: true },
    });
    return new Map(rows.map((row) => [row.id, row.fullName]));
  }

  // Name, email and phone of these accounts for alert delivery (auth task 5.2); `isActive` lets the
  // caller skip an account that can no longer receive alerts. Soft-deleted accounts are left out.
  async contactCards(ids: readonly string[], client: Client = this.prisma): Promise<ContactCard[]> {
    const rows = await client.user.findMany({
      where: { id: { in: [...ids] }, deletedAt: null },
      orderBy: { fullName: 'asc' },
      select: { ...CONTACT_CARD_SELECT, passwordHash: true },
    });
    return rows.map(({ passwordHash, ...card }) => ({
      ...card,
      passwordSet: passwordHash !== null,
    }));
  }
}
