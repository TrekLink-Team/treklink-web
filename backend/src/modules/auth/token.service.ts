import { createHash, randomBytes, randomUUID } from 'crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthEventType, Prisma } from '@prisma/client';
import { DomainException, ErrorCode } from '../../common/errors';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { AccountSessionService, SessionUser } from './account-session.service';
import { AccountsRepository } from './accounts.repository';
import { PermissionCache } from './casl/permission-cache';

export interface AccessTokenPayload {
  sub: string;
  accountType: SessionUser['accountType'];
  roles: string[];
  organizationId?: string;
  memberRole?: string;
  // The permission cache version the token was issued under (specs/auth/design.md §2).
  pv: number;
}

export interface TokenPair {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresIn: number;
}

export interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
}

const DURATION_SECONDS: Readonly<Record<string, number>> = { s: 1, m: 60, h: 3600, d: 86400 };

// JWT_ACCESS_TTL and JWT_REFRESH_TTL are validated as <n><s|m|h|d> at boot.
export const durationToSeconds = (duration: string): number => {
  const match = /^(\d+)([smhd])$/.exec(duration);
  if (!match) throw new Error(`Invalid duration ${duration}`);
  return Number(match[1]) * DURATION_SECONDS[match[2]];
};

export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

// An organization API key is stored only as the SHA-256 hex of the whole key, `tlk_` prefix included
// (organizations api-design 21). The socket handshake, `ApiKeyGuard` and key creation all hash through
// this one function, so a key resolves the same way everywhere.
export const hashApiKey = (key: string): string => hashToken(key);

const sessionEnded = (code: ErrorCode.REFRESH_INVALID | ErrorCode.REFRESH_REUSED) =>
  new DomainException(
    HttpStatus.UNAUTHORIZED,
    code,
    'Your session has ended. Please sign in again.',
  );

// Thrown inside the rotation transaction when another request rotated the same token first.
class ConcurrentRotation extends Error {}

// Access and refresh tokens (auth task 2.3, FR-AUTH-02 to FR-AUTH-04). The refresh token is 32
// random bytes, stored only as SHA-256 (REQ-UBI-02), one family per sign-in, rotations chained
// through replacedById so that presenting a rotated token again revokes the family (REQ-ERR-02).
@Injectable()
export class TokenService {
  private readonly accessTtlSeconds: number;
  private readonly refreshTtlSeconds: number;

  constructor(
    private readonly jwt: JwtService,
    private readonly accounts: AccountsRepository,
    private readonly sessions: AccountSessionService,
    private readonly events: TransactionalEvents,
    private readonly permissions: PermissionCache,
    config: ConfigService<ValidatedEnvironment, true>,
  ) {
    this.accessTtlSeconds = durationToSeconds(config.get('JWT_ACCESS_TTL', { infer: true }));
    this.refreshTtlSeconds = durationToSeconds(config.get('JWT_REFRESH_TTL', { infer: true }));
  }

  // Issues an access token and a refresh token, in a new family unless one is given.
  async issue(
    user: SessionUser,
    client: ClientInfo,
    tx: Prisma.TransactionClient,
    familyId: string = randomUUID(),
  ): Promise<{ tokens: TokenPair; refreshTokenId: string }> {
    const refreshToken = `rt_${randomBytes(32).toString('base64url')}`;
    const { id } = await this.accounts.createRefreshToken(
      {
        userId: user.id,
        familyId,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + this.refreshTtlSeconds * 1000),
        ip: client.ip,
        userAgent: client.userAgent,
      },
      tx,
    );

    const payload: AccessTokenPayload = {
      sub: user.id,
      accountType: user.accountType,
      roles: user.roles,
      ...(user.organization
        ? { organizationId: user.organization.id, memberRole: user.organization.memberRole }
        : {}),
      pv: this.permissions.version,
    };

    return {
      tokens: {
        accessToken: await this.jwt.signAsync(payload),
        accessTokenExpiresIn: this.accessTtlSeconds,
        refreshToken,
        refreshTokenExpiresIn: this.refreshTtlSeconds,
      },
      refreshTokenId: id,
    };
  }

  // Rotates a refresh token (REQ-EVT-02): re-reads the account and its membership, issues a new
  // pair in the same family and revokes the presented token. Only the pair is returned; clients
  // read GET /api/auth/me for fresh roles (api-design 02, D-060 rule 7).
  async refresh(refreshToken: string, client: ClientInfo): Promise<TokenPair> {
    const now = new Date();
    const row = await this.accounts.findRefreshTokenByHash(hashToken(refreshToken));
    if (!row) throw sessionEnded(ErrorCode.REFRESH_INVALID);

    if (row.revokedAt) {
      // Rotated before: a replay. Revoked without a successor: signed out.
      if (row.replacedById) return this.revokeReusedFamily(row.userId, row.familyId, now, client);
      throw sessionEnded(ErrorCode.REFRESH_INVALID);
    }
    if (row.expiresAt <= now) throw sessionEnded(ErrorCode.REFRESH_INVALID);

    // A deactivated account loses every session at once (REQ-EVT-07).
    const user = await this.sessions.load(row.userId);
    if (!user) {
      await this.accounts.revokeFamily(row.userId, row.familyId, now);
      throw sessionEnded(ErrorCode.REFRESH_INVALID);
    }

    try {
      return await this.events.transaction(async (tx) => {
        const { tokens: pair, refreshTokenId } = await this.issue(user, client, tx, row.familyId);
        if (!(await this.accounts.revokeIfLive(row.id, now, refreshTokenId, tx))) {
          throw new ConcurrentRotation();
        }
        await this.accounts.insertAuthEvent(
          {
            userId: user.id,
            email: user.email,
            type: AuthEventType.TOKEN_REFRESHED,
            ...client,
          },
          tx,
        );
        return pair;
      });
    } catch (error) {
      if (!(error instanceof ConcurrentRotation)) throw error;
      return this.revokeReusedFamily(row.userId, row.familyId, now, client);
    }
  }

  // Revokes the presented refresh token of the signed-in user (REQ-EVT-03). An unknown or already
  // revoked token is not an error: the session is ended either way.
  async logout(userId: string, refreshToken: string, client: ClientInfo): Promise<void> {
    await this.events.transaction(async (tx) => {
      await this.accounts.revokeUserToken(userId, hashToken(refreshToken), new Date(), tx);
      await this.accounts.insertAuthEvent(
        { userId, email: null, type: AuthEventType.LOGOUT, ...client },
        tx,
      );
    });
  }

  // A rotated token presented again: the whole family is revoked and the reuse recorded (REQ-ERR-02).
  private async revokeReusedFamily(
    userId: string,
    familyId: string,
    at: Date,
    client: ClientInfo,
  ): Promise<never> {
    await this.events.transaction(async (tx) => {
      await this.accounts.revokeFamily(userId, familyId, at, tx);
      await this.accounts.insertAuthEvent(
        { userId, email: null, type: AuthEventType.TOKEN_REUSE_DETECTED, ...client },
        tx,
      );
    });
    throw sessionEnded(ErrorCode.REFRESH_REUSED);
  }
}
