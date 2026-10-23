import { HttpStatus, Injectable } from '@nestjs/common';
import { AccountType, AuthEventType, Prisma } from '@prisma/client';
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

export interface NewRefreshToken {
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  ip: string | null;
  userAgent: string | null;
}

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

  // The permissions granted to the role with this key; an unknown key grants nothing (auth task 4.1).
  async findRolePermissions(roleKey: string): Promise<PermissionRuleRow[]> {
    const grants = await this.prisma.rolePermission.findMany({
      where: { role: { key: roleKey } },
      select: { permission: { select: PERMISSION_RULE_SELECT } },
    });
    return grants.map((grant) => grant.permission);
  }
}
