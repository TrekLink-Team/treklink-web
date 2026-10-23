import { AuthEventType, Prisma } from '@prisma/client';
import { ErrorCode } from '../../common/errors';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
import { AccountSessionService } from './account-session.service';
import { AccountsRepository } from './accounts.repository';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { anAccount, aSessionUser, CLIENT } from './testing/auth-fixtures';
import { TokenService } from './token.service';

const tx = { tx: true } as unknown as Prisma.TransactionClient;
const NOW = new Date('2026-10-23T03:00:00.000Z');
const MINUTE = 60_000;
const TOKENS = {
  accessToken: 'access.jwt',
  accessTokenExpiresIn: 900,
  refreshToken: 'rt_new',
  refreshTokenExpiresIn: 1_209_600,
};
const PARAMETERS: Record<string, number> = {
  'auth.loginMaxFailures': 5,
  'auth.loginFailureWindowMinutes': 15,
  'auth.lockoutMinutes': 15,
};

describe('AuthService', () => {
  let accounts: Record<string, jest.Mock>;
  let sessions: { eligible: jest.Mock; load: jest.Mock };
  let passwords: { verify: jest.Mock };
  let tokens: { issue: jest.Mock; refresh: jest.Mock; logout: jest.Mock };
  let service: AuthService;

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    accounts = {
      findByEmail: jest.fn().mockResolvedValue(anAccount()),
      recordLoginSuccess: jest.fn().mockResolvedValue(undefined),
      recordLoginFailure: jest.fn().mockResolvedValue(undefined),
      countLoginFailuresSince: jest.fn().mockResolvedValue(1),
      insertAuthEvent: jest.fn().mockResolvedValue(undefined),
    };
    sessions = {
      eligible: jest.fn().mockResolvedValue(aSessionUser()),
      load: jest.fn().mockResolvedValue(aSessionUser()),
    };
    passwords = { verify: jest.fn().mockResolvedValue(true) };
    tokens = {
      issue: jest.fn().mockResolvedValue({ tokens: TOKENS, refreshTokenId: 'rt-1' }),
      refresh: jest.fn().mockResolvedValue({ tokens: TOKENS, user: aSessionUser() }),
      logout: jest.fn().mockResolvedValue(undefined),
    };
    const parameters = { get: jest.fn((key: string) => Promise.resolve(PARAMETERS[key])) };
    const events = {
      transaction: jest.fn((work: (client: Prisma.TransactionClient) => unknown) => work(tx)),
    };
    service = new AuthService(
      accounts as unknown as AccountsRepository,
      sessions as unknown as AccountSessionService,
      passwords as unknown as PasswordService,
      tokens as unknown as TokenService,
      parameters as unknown as ParameterService,
      events as unknown as TransactionalEvents,
    );
  });

  afterEach(() => jest.useRealTimers());

  describe('login', () => {
    it('signs in, resets the failure counter and records the success (REQ-EVT-01)', async () => {
      const result = await service.login(
        { email: '  Staff@TrekLink.vn ', password: 'secret-pass' },
        CLIENT,
      );

      expect(accounts.findByEmail).toHaveBeenCalledWith('staff@treklink.vn');
      expect(passwords.verify).toHaveBeenCalledWith('secret-pass', '$2b$04$hash');
      expect(accounts.recordLoginSuccess).toHaveBeenCalledWith('user-1', NOW, tx);
      expect(accounts.insertAuthEvent).toHaveBeenCalledWith(
        {
          userId: 'user-1',
          email: 'staff@treklink.vn',
          type: AuthEventType.LOGIN_SUCCEEDED,
          ...CLIENT,
        },
        tx,
      );
      expect(result).toEqual({ ...TOKENS, user: aSessionUser() });
    });

    it('answers a wrong password with one message and counts the failure (REQ-ERR-01)', async () => {
      passwords.verify.mockResolvedValue(false);

      await expect(
        service.login({ email: 'staff@treklink.vn', password: 'x' }, CLIENT),
      ).rejects.toMatchObject({
        errorCode: ErrorCode.INVALID_CREDENTIALS,
        message: 'Incorrect email or password. Please try again.',
      });
      expect(accounts.insertAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: AuthEventType.LOGIN_FAILED, userId: 'user-1' }),
        tx,
      );
      expect(accounts.recordLoginFailure).toHaveBeenCalledWith('user-1', 1, null, tx);
      expect(tokens.issue).not.toHaveBeenCalled();
      // The event never carries the attempted password (REQ-UBI-08).
      expect(JSON.stringify(accounts.insertAuthEvent.mock.calls)).not.toContain('"x"');
    });

    it('answers an unknown email with the same body after a dummy compare', async () => {
      accounts.findByEmail.mockResolvedValue(null);
      passwords.verify.mockResolvedValue(false);

      await expect(
        service.login({ email: 'who@nowhere.vn', password: 'x' }, CLIENT),
      ).rejects.toMatchObject({
        errorCode: ErrorCode.INVALID_CREDENTIALS,
        message: 'Incorrect email or password. Please try again.',
      });
      expect(passwords.verify).toHaveBeenCalledWith('x', null);
      expect(accounts.insertAuthEvent).toHaveBeenCalledWith({
        userId: null,
        email: 'who@nowhere.vn',
        type: AuthEventType.LOGIN_FAILED,
        ...CLIENT,
      });
      expect(accounts.recordLoginFailure).not.toHaveBeenCalled();
    });

    it('refuses a correct password when the account may not hold a session (REQ-STA-02, REQ-STA-03)', async () => {
      sessions.eligible.mockResolvedValue(null);

      await expect(
        service.login({ email: 'staff@treklink.vn', password: 'p' }, CLIENT),
      ).rejects.toMatchObject({ errorCode: ErrorCode.INVALID_CREDENTIALS });
      expect(tokens.issue).not.toHaveBeenCalled();
    });

    it('locks the account at the threshold and answers 423 (REQ-STA-01)', async () => {
      passwords.verify.mockResolvedValue(false);
      accounts.countLoginFailuresSince.mockResolvedValue(5);

      await expect(
        service.login({ email: 'staff@treklink.vn', password: 'x' }, CLIENT),
      ).rejects.toMatchObject({
        errorCode: ErrorCode.ACCOUNT_LOCKED,
        message: 'Too many attempts. Try again in 15 minutes.',
      });
      expect(accounts.recordLoginFailure).toHaveBeenCalledWith(
        'user-1',
        5,
        new Date(NOW.getTime() + 15 * MINUTE),
        tx,
      );
      expect(accounts.insertAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: AuthEventType.ACCOUNT_LOCKED }),
        tx,
      );
    });

    it('counts failures only inside the window and after the last sign-in or lock', async () => {
      passwords.verify.mockResolvedValue(false);

      await expect(service.login({ email: 'a@b.vn', password: 'x' }, CLIENT)).rejects.toBeTruthy();
      expect(accounts.countLoginFailuresSince).toHaveBeenLastCalledWith(
        'user-1',
        new Date(NOW.getTime() - 15 * MINUTE),
        tx,
      );

      const lastLoginAt = new Date(NOW.getTime() - 5 * MINUTE);
      accounts.findByEmail.mockResolvedValue(anAccount({ lastLoginAt }));
      await expect(service.login({ email: 'a@b.vn', password: 'x' }, CLIENT)).rejects.toBeTruthy();
      expect(accounts.countLoginFailuresSince).toHaveBeenLastCalledWith('user-1', lastLoginAt, tx);

      const lockEnded = new Date(NOW.getTime() - 2 * MINUTE);
      accounts.findByEmail.mockResolvedValue(anAccount({ lastLoginAt, lockedUntil: lockEnded }));
      await expect(service.login({ email: 'a@b.vn', password: 'x' }, CLIENT)).rejects.toBeTruthy();
      expect(accounts.countLoginFailuresSince).toHaveBeenLastCalledWith('user-1', lockEnded, tx);
    });

    it('refuses a locked account before checking its password, with the minutes left', async () => {
      accounts.findByEmail.mockResolvedValue(
        anAccount({ lockedUntil: new Date(NOW.getTime() + 4 * MINUTE + 1) }),
      );

      await expect(
        service.login({ email: 'staff@treklink.vn', password: 'p' }, CLIENT),
      ).rejects.toMatchObject({
        errorCode: ErrorCode.ACCOUNT_LOCKED,
        message: 'Too many attempts. Try again in 5 minutes.',
      });
      expect(passwords.verify).not.toHaveBeenCalled();
      expect(accounts.insertAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: AuthEventType.LOGIN_FAILED, userId: 'user-1' }),
      );
    });

    it('lets an account in again once its lock has passed', async () => {
      accounts.findByEmail.mockResolvedValue(
        anAccount({ lockedUntil: new Date(NOW.getTime() - MINUTE) }),
      );

      await expect(
        service.login({ email: 'staff@treklink.vn', password: 'p' }, CLIENT),
      ).resolves.toMatchObject({ accessToken: 'access.jwt' });
    });
  });

  it('refresh returns the rotated pair with the current account', async () => {
    await expect(service.refresh('rt_old', CLIENT)).resolves.toEqual({
      ...TOKENS,
      user: aSessionUser(),
    });
    expect(tokens.refresh).toHaveBeenCalledWith('rt_old', CLIENT);
  });

  it('logout delegates to the token service', async () => {
    await service.logout('user-1', 'rt_x', CLIENT);
    expect(tokens.logout).toHaveBeenCalledWith('user-1', 'rt_x', CLIENT);
  });

  describe('me', () => {
    it('returns the current account', async () => {
      await expect(service.me('user-1')).resolves.toEqual(aSessionUser());
    });

    it('answers 401 when the account can no longer hold a session', async () => {
      sessions.load.mockResolvedValue(null);
      await expect(service.me('user-1')).rejects.toMatchObject({
        errorCode: ErrorCode.UNAUTHENTICATED,
      });
    });
  });
});
