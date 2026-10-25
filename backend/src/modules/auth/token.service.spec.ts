import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthEventType, Prisma } from '@prisma/client';
import { ErrorCode } from '../../common/errors';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { AccountSessionService } from './account-session.service';
import { AccountsRepository } from './accounts.repository';
import { PermissionCache } from './casl/permission-cache';
import { aSessionUser, CLIENT } from './testing/auth-fixtures';
import { durationToSeconds, hashApiKey, hashToken, TokenService } from './token.service';

const tx = { tx: true } as unknown as Prisma.TransactionClient;
const NOW = new Date('2026-10-23T03:00:00.000Z');

const liveToken = (overrides: Record<string, unknown> = {}) => ({
  id: 'rt-1',
  userId: 'user-1',
  familyId: 'family-1',
  expiresAt: new Date(NOW.getTime() + 3_600_000),
  revokedAt: null,
  replacedById: null,
  ...overrides,
});

describe('durationToSeconds', () => {
  it.each([
    ['30s', 30],
    ['15m', 900],
    ['1h', 3600],
    ['14d', 1_209_600],
  ])('reads %s as %d seconds', (duration, seconds) => {
    expect(durationToSeconds(duration)).toBe(seconds);
  });

  it('refuses anything else', () => {
    expect(() => durationToSeconds('2w')).toThrow('Invalid duration 2w');
  });
});

describe('hashApiKey', () => {
  it('is the SHA-256 hex of the whole key, prefix included', () => {
    expect(hashApiKey('tlk_abc')).toBe(
      '263d00eaf6bf7f006b141bfdd38d30d3aebb3e5d65badf8968daee880830a5f7',
    );
    expect(hashApiKey('tlk_abc')).not.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('TokenService', () => {
  let jwt: { signAsync: jest.Mock };
  let accounts: Record<string, jest.Mock>;
  let sessions: { load: jest.Mock };
  let events: { transaction: jest.Mock };
  let service: TokenService;

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    jwt = { signAsync: jest.fn().mockResolvedValue('access.jwt') };
    accounts = {
      createRefreshToken: jest.fn().mockResolvedValue({ id: 'rt-2' }),
      findRefreshTokenByHash: jest.fn(),
      revokeIfLive: jest.fn().mockResolvedValue(true),
      revokeFamily: jest.fn().mockResolvedValue(undefined),
      revokeUserToken: jest.fn().mockResolvedValue(true),
      insertAuthEvent: jest.fn().mockResolvedValue(undefined),
    };
    sessions = { load: jest.fn().mockResolvedValue(aSessionUser()) };
    events = {
      transaction: jest.fn((work: (client: Prisma.TransactionClient) => unknown) => work(tx)),
    };
    const config = {
      get: jest.fn((key: string) => (key === 'JWT_ACCESS_TTL' ? '15m' : '14d')),
    };
    service = new TokenService(
      jwt as unknown as JwtService,
      accounts as unknown as AccountsRepository,
      sessions as unknown as AccountSessionService,
      events as unknown as TransactionalEvents,
      { version: 3 } as PermissionCache,
      config as unknown as ConfigService<ValidatedEnvironment, true>,
    );
  });

  afterEach(() => jest.useRealTimers());

  describe('issue', () => {
    it('signs the access token and stores only the hash of a new refresh token (REQ-UBI-02)', async () => {
      const { tokens, refreshTokenId } = await service.issue(aSessionUser(), CLIENT, tx);

      expect(tokens).toEqual({
        accessToken: 'access.jwt',
        accessTokenExpiresIn: 900,
        refreshToken: expect.stringMatching(/^rt_[A-Za-z0-9_-]{43}$/) as string,
        refreshTokenExpiresIn: 1_209_600,
      });
      expect(refreshTokenId).toBe('rt-2');
      expect(jwt.signAsync).toHaveBeenCalledWith({
        sub: 'user-1',
        accountType: 'TREKLINK',
        roles: ['STAFF'],
        pv: 3,
      });
      const [stored, client] = accounts.createRefreshToken.mock.calls[0] as [
        Record<string, unknown>,
        unknown,
      ];
      expect(stored).toMatchObject({
        userId: 'user-1',
        tokenHash: hashToken(tokens.refreshToken),
        expiresAt: new Date(NOW.getTime() + 1_209_600_000),
        ip: '10.0.0.1',
        userAgent: 'jest',
      });
      expect(stored.tokenHash).not.toBe(tokens.refreshToken);
      expect(client).toBe(tx);
    });

    it('opens a new family per sign-in and keeps a given one', async () => {
      await service.issue(aSessionUser(), CLIENT, tx);
      await service.issue(aSessionUser(), CLIENT, tx);
      await service.issue(aSessionUser(), CLIENT, tx, 'family-9');

      const families = accounts.createRefreshToken.mock.calls.map(
        ([token]) => (token as { familyId: string }).familyId,
      );
      expect(families[0]).not.toBe(families[1]);
      expect(families[2]).toBe('family-9');
    });

    it('carries the organization and member role of a member', async () => {
      await service.issue(
        aSessionUser({
          accountType: 'ORGANIZATION',
          roles: ['ORG_OPERATOR'],
          organization: {
            id: 'org-1',
            code: 'ORG-0001',
            legalName: 'ACME Trek Co., Ltd.',
            status: 'ACTIVE',
            memberRole: 'OPERATOR',
          },
        }),
        CLIENT,
        tx,
      );
      expect(jwt.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org-1', memberRole: 'OPERATOR' }),
      );
    });
  });

  describe('refresh', () => {
    it('rotates within the family, chains the old token and records the refresh', async () => {
      accounts.findRefreshTokenByHash.mockResolvedValue(liveToken());

      const tokens = await service.refresh('rt_presented', CLIENT);

      expect(accounts.findRefreshTokenByHash).toHaveBeenCalledWith(hashToken('rt_presented'));
      expect(accounts.createRefreshToken).toHaveBeenCalledWith(
        expect.objectContaining({ familyId: 'family-1' }),
        tx,
      );
      expect(accounts.revokeIfLive).toHaveBeenCalledWith('rt-1', NOW, 'rt-2', tx);
      expect(accounts.insertAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: AuthEventType.TOKEN_REFRESHED, userId: 'user-1' }),
        tx,
      );
      expect(tokens).toEqual({
        accessToken: 'access.jwt',
        accessTokenExpiresIn: 900,
        refreshToken: expect.stringMatching(/^rt_/) as string,
        refreshTokenExpiresIn: 1_209_600,
      });
    });

    it.each([
      ['unknown', null],
      ['signed out', liveToken({ revokedAt: NOW })],
      ['expired', liveToken({ expiresAt: NOW })],
    ])('refuses an %s token with REFRESH_INVALID', async (_label, row) => {
      accounts.findRefreshTokenByHash.mockResolvedValue(row);

      await expect(service.refresh('rt_x', CLIENT)).rejects.toMatchObject({
        errorCode: ErrorCode.REFRESH_INVALID,
        message: 'Your session has ended. Please sign in again.',
      });
      expect(accounts.revokeFamily).not.toHaveBeenCalled();
    });

    it('revokes the whole family when a rotated token is presented again (REQ-ERR-02, AC-02)', async () => {
      accounts.findRefreshTokenByHash.mockResolvedValue(
        liveToken({ revokedAt: NOW, replacedById: 'rt-2' }),
      );

      await expect(service.refresh('rt_old', CLIENT)).rejects.toMatchObject({
        errorCode: ErrorCode.REFRESH_REUSED,
      });
      expect(accounts.revokeFamily).toHaveBeenCalledWith('user-1', 'family-1', NOW, tx);
      expect(accounts.insertAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: AuthEventType.TOKEN_REUSE_DETECTED }),
        tx,
      );
    });

    it('ends every session of an account that may no longer sign in (REQ-EVT-07)', async () => {
      accounts.findRefreshTokenByHash.mockResolvedValue(liveToken());
      sessions.load.mockResolvedValue(null);

      await expect(service.refresh('rt_x', CLIENT)).rejects.toMatchObject({
        errorCode: ErrorCode.REFRESH_INVALID,
      });
      expect(accounts.revokeFamily).toHaveBeenCalledWith('user-1', 'family-1', NOW);
      expect(accounts.createRefreshToken).not.toHaveBeenCalled();
    });

    it('treats a token rotated concurrently by another request as reuse', async () => {
      accounts.findRefreshTokenByHash.mockResolvedValue(liveToken());
      accounts.revokeIfLive.mockResolvedValue(false);

      await expect(service.refresh('rt_x', CLIENT)).rejects.toMatchObject({
        errorCode: ErrorCode.REFRESH_REUSED,
      });
      expect(accounts.revokeFamily).toHaveBeenCalledWith('user-1', 'family-1', NOW, tx);
    });

    it('lets any other failure inside the rotation through unchanged', async () => {
      accounts.findRefreshTokenByHash.mockResolvedValue(liveToken());
      accounts.createRefreshToken.mockRejectedValue(new Error('database down'));

      await expect(service.refresh('rt_x', CLIENT)).rejects.toThrow('database down');
      expect(accounts.revokeFamily).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('revokes the presented token of the caller and records the sign-out (REQ-EVT-03)', async () => {
      await service.logout('user-1', 'rt_presented', CLIENT);

      expect(accounts.revokeUserToken).toHaveBeenCalledWith(
        'user-1',
        hashToken('rt_presented'),
        NOW,
        tx,
      );
      expect(accounts.insertAuthEvent).toHaveBeenCalledWith(
        { userId: 'user-1', email: null, type: AuthEventType.LOGOUT, ...CLIENT },
        tx,
      );
    });
  });
});
