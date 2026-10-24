import { Logger } from '@nestjs/common';
import { AuthEventType, OtpPurpose, Prisma } from '@prisma/client';
import { DomainException, ErrorCode } from '../../common/errors';
import { AUDIT_RECORD } from '../platform/audit/audit-record.event';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { AccountSessionService } from './account-session.service';
import { AccountsRepository } from './accounts.repository';
import { codeInvalid, OneTimeCodeService } from './one-time-code.service';
import { codeEmail, PasswordFlowsService } from './password-flows.service';
import { PasswordService } from './password.service';
import { anAccount, aSessionUser, CLIENT } from './testing/auth-fixtures';
import { TokenService } from './token.service';

const tx = { tx: true } as unknown as Prisma.TransactionClient;
const NOW = new Date('2026-10-24T03:00:00.000Z');
const ISSUED = { code: '482913', lifetimeMs: 10 * 60_000 };
const TOKENS = {
  accessToken: 'access.jwt',
  accessTokenExpiresIn: 900,
  refreshToken: 'rt_x',
  refreshTokenExpiresIn: 1_209_600,
};
const STAFF = { id: 'staff-1', roles: ['STAFF'], organizationId: null };
const RESET = { email: 'Staff@TrekLink.vn', code: '482913', password: 'new-password' };

describe('codeEmail', () => {
  it('names a reset code and its validity in minutes', () => {
    expect(codeEmail('a@treklink.vn', OtpPurpose.PASSWORD_RESET, ISSUED)).toEqual({
      to: 'a@treklink.vn',
      subject: 'Your TrekLink password reset code',
      text:
        'Your TrekLink password reset code is 482913. It is valid for 10 minutes. ' +
        'If you did not ask to reset your password, ignore this email.',
    });
  });

  it('names an invitation code and its validity in hours', () => {
    const message = codeEmail('a@treklink.vn', OtpPurpose.SET_PASSWORD, {
      code: '739104',
      lifetimeMs: 72 * 3_600_000,
    });
    expect(message.subject).toBe('Your TrekLink invitation code');
    expect(message.text).toContain('739104. It is valid for 72 hours.');
  });
});

describe('PasswordFlowsService', () => {
  let accounts: Record<string, jest.Mock>;
  let sessions: { eligible: jest.Mock };
  let passwords: Record<string, jest.Mock>;
  let codes: Record<string, jest.Mock>;
  let tokens: { issue: jest.Mock };
  let events: { transaction: jest.Mock; emitAfterCommit: jest.Mock };
  let mail: { send: jest.Mock };
  let service: PasswordFlowsService;

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    accounts = {
      findByEmail: jest.fn().mockResolvedValue(anAccount()),
      findById: jest.fn().mockResolvedValue(anAccount()),
      insertAuthEvent: jest.fn().mockResolvedValue(undefined),
      consumeCode: jest.fn().mockResolvedValue(true),
      setPasswordHash: jest.fn().mockResolvedValue(undefined),
      revokeAllUserTokens: jest.fn().mockResolvedValue(undefined),
      recordLoginSuccess: jest.fn().mockResolvedValue(undefined),
    };
    sessions = { eligible: jest.fn().mockResolvedValue(aSessionUser()) };
    passwords = {
      assertPolicy: jest.fn().mockResolvedValue(undefined),
      hash: jest.fn().mockResolvedValue('$2b$04$new'),
      verify: jest.fn().mockResolvedValue(true),
    };
    codes = {
      assertCooldown: jest.fn().mockResolvedValue(undefined),
      issue: jest.fn().mockResolvedValue(ISSUED),
      verify: jest.fn().mockResolvedValue('otp-1'),
    };
    tokens = { issue: jest.fn().mockResolvedValue({ tokens: TOKENS, refreshTokenId: 'rt-1' }) };
    events = {
      transaction: jest.fn((work: (client: Prisma.TransactionClient) => unknown) => work(tx)),
      emitAfterCommit: jest.fn(),
    };
    mail = { send: jest.fn().mockResolvedValue(undefined) };
    service = new PasswordFlowsService(
      accounts as unknown as AccountsRepository,
      sessions as unknown as AccountSessionService,
      passwords as unknown as PasswordService,
      codes as unknown as OneTimeCodeService,
      tokens as unknown as TokenService,
      events as unknown as TransactionalEvents,
      mail,
    );
  });

  afterEach(() => jest.useRealTimers());

  describe('forgot (api-design 05)', () => {
    it('emails a PASSWORD_RESET code to an account with a password and records the request', async () => {
      await expect(service.forgot('  Staff@TrekLink.vn ', CLIENT)).resolves.toBeUndefined();

      expect(accounts.findByEmail).toHaveBeenCalledWith('staff@treklink.vn');
      expect(codes.assertCooldown).toHaveBeenCalledWith('user-1', NOW);
      expect(codes.issue).toHaveBeenCalledWith('user-1', OtpPurpose.PASSWORD_RESET, NOW, tx);
      expect(accounts.insertAuthEvent).toHaveBeenCalledWith(
        {
          userId: 'user-1',
          email: 'staff@treklink.vn',
          type: AuthEventType.PASSWORD_RESET_REQUESTED,
          ...CLIENT,
        },
        tx,
      );
      expect(mail.send).toHaveBeenCalledWith(
        codeEmail('staff@treklink.vn', OtpPurpose.PASSWORD_RESET, ISSUED),
      );
    });

    it('sends a SET_PASSWORD code to an account that never set a password (D-059 rule 6)', async () => {
      accounts.findByEmail.mockResolvedValue(anAccount({ passwordHash: null }));

      await service.forgot('staff@treklink.vn', CLIENT);
      expect(codes.issue).toHaveBeenCalledWith('user-1', OtpPurpose.SET_PASSWORD, NOW, tx);
    });

    it.each([
      ['an unknown email', null, null],
      ['an inactive account', anAccount({ isActive: false }), 'user-1'],
      ['a soft-deleted account', anAccount({ deletedAt: NOW }), 'user-1'],
    ])(
      'answers the same for %s and sends nothing (FR-AUTH-05)',
      async (_label, account, userId) => {
        accounts.findByEmail.mockResolvedValue(account);

        await expect(service.forgot('ghost@treklink.vn', CLIENT)).resolves.toBeUndefined();
        expect(accounts.insertAuthEvent).toHaveBeenCalledWith({
          userId,
          email: 'ghost@treklink.vn',
          type: AuthEventType.PASSWORD_RESET_REQUESTED,
          ...CLIENT,
        });
        expect(codes.issue).not.toHaveBeenCalled();
        expect(mail.send).not.toHaveBeenCalled();
      },
    );

    it('passes the cooldown refusal through and sends nothing', async () => {
      codes.assertCooldown.mockRejectedValue(new Error('cooldown'));

      await expect(service.forgot('staff@treklink.vn', CLIENT)).rejects.toThrow('cooldown');
      expect(mail.send).not.toHaveBeenCalled();
    });

    it('logs a failed send without the code and still answers (AC-06)', async () => {
      const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      mail.send.mockRejectedValueOnce(new TypeError('smtp down 482913'));

      await expect(service.forgot('staff@treklink.vn', CLIENT)).resolves.toBeUndefined();
      expect(logged).toHaveBeenCalledWith('Code email to account user-1 failed: TypeError');

      mail.send.mockRejectedValueOnce('not an error');
      await service.forgot('staff@treklink.vn', CLIENT);
      expect(logged).toHaveBeenLastCalledWith('Code email to account user-1 failed: unknown error');
      logged.mockRestore();
    });
  });

  describe('reset (api-design 06)', () => {
    it('sets the hash, spends the code and revokes every refresh token (REQ-EVT-05)', async () => {
      await expect(service.reset(RESET, CLIENT)).resolves.toBeUndefined();

      expect(codes.verify).toHaveBeenCalledWith('user-1', OtpPurpose.PASSWORD_RESET, '482913', NOW);
      expect(passwords.assertPolicy).toHaveBeenCalledWith('new-password');
      expect(accounts.consumeCode).toHaveBeenCalledWith('otp-1', NOW, tx);
      expect(accounts.setPasswordHash).toHaveBeenCalledWith('user-1', '$2b$04$new', tx);
      expect(accounts.revokeAllUserTokens).toHaveBeenCalledWith('user-1', NOW, tx);
      expect(accounts.insertAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: AuthEventType.PASSWORD_RESET_COMPLETED }),
        tx,
      );
    });

    it.each([
      ['an unknown email', null],
      ['an inactive account', anAccount({ isActive: false })],
    ])('refuses %s with MSG08 without checking a code', async (_label, account) => {
      accounts.findByEmail.mockResolvedValue(account);

      await expect(service.reset(RESET, CLIENT)).rejects.toMatchObject({
        errorCode: ErrorCode.CODE_INVALID,
      });
      expect(codes.verify).not.toHaveBeenCalled();
    });

    it('stops at a refused code or password before anything changes', async () => {
      codes.verify.mockRejectedValueOnce(codeInvalid());
      await expect(service.reset(RESET, CLIENT)).rejects.toBeInstanceOf(DomainException);

      passwords.assertPolicy.mockRejectedValueOnce(new Error('policy'));
      await expect(service.reset(RESET, CLIENT)).rejects.toThrow('policy');
      expect(accounts.setPasswordHash).not.toHaveBeenCalled();
    });

    it('refuses a code another request consumed first', async () => {
      accounts.consumeCode.mockResolvedValue(false);

      await expect(service.reset(RESET, CLIENT)).rejects.toMatchObject({
        errorCode: ErrorCode.CODE_INVALID,
      });
      expect(accounts.setPasswordHash).not.toHaveBeenCalled();
    });
  });

  describe('setPassword (api-design 07)', () => {
    beforeEach(() => accounts.findByEmail.mockResolvedValue(anAccount({ passwordHash: null })));

    it('sets the first password and signs the user in (REQ-EVT-06)', async () => {
      await expect(service.setPassword(RESET, CLIENT)).resolves.toEqual({
        ...TOKENS,
        user: aSessionUser(),
      });

      expect(codes.verify).toHaveBeenCalledWith('user-1', OtpPurpose.SET_PASSWORD, '482913', NOW);
      expect(sessions.eligible).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'user-1', passwordHash: '$2b$04$new' }),
      );
      expect(accounts.setPasswordHash).toHaveBeenCalledWith('user-1', '$2b$04$new', tx);
      expect(accounts.insertAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: AuthEventType.PASSWORD_SET }),
        tx,
      );
      expect(accounts.recordLoginSuccess).toHaveBeenCalledWith('user-1', NOW, tx);
      expect(accounts.insertAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: AuthEventType.LOGIN_SUCCEEDED }),
        tx,
      );
      expect(tokens.issue).toHaveBeenCalledWith(aSessionUser(), CLIENT, tx);
    });

    it('keeps the password but refuses the session of an account that may not sign in', async () => {
      sessions.eligible.mockResolvedValue(null);

      await expect(service.setPassword(RESET, CLIENT)).rejects.toMatchObject({
        errorCode: ErrorCode.INVALID_CREDENTIALS,
      });
      expect(accounts.setPasswordHash).toHaveBeenCalled();
      expect(tokens.issue).not.toHaveBeenCalled();
    });

    it('refuses an unknown email, and a code another request consumed first', async () => {
      accounts.findByEmail.mockResolvedValueOnce(null);
      await expect(service.setPassword(RESET, CLIENT)).rejects.toMatchObject({
        errorCode: ErrorCode.CODE_INVALID,
      });

      accounts.consumeCode.mockResolvedValue(false);
      await expect(service.setPassword(RESET, CLIENT)).rejects.toMatchObject({
        errorCode: ErrorCode.CODE_INVALID,
      });
      expect(accounts.setPasswordHash).not.toHaveBeenCalled();
    });
  });

  describe('change (api-design 08)', () => {
    const change = { currentPassword: 'old-password', newPassword: 'new-password' };

    it('stores the new hash and revokes every session of the account', async () => {
      await expect(service.change('user-1', change, CLIENT)).resolves.toBeUndefined();

      expect(passwords.verify).toHaveBeenCalledWith('old-password', '$2b$04$hash');
      expect(passwords.assertPolicy).toHaveBeenCalledWith('new-password');
      expect(accounts.setPasswordHash).toHaveBeenCalledWith('user-1', '$2b$04$new', tx);
      expect(accounts.revokeAllUserTokens).toHaveBeenCalledWith('user-1', NOW, tx);
      expect(accounts.insertAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: AuthEventType.PASSWORD_SET }),
        tx,
      );
    });

    it.each([
      ['a wrong current password', anAccount(), false],
      ['an account that no longer exists', null, false],
    ])('answers 400 INVALID_CREDENTIALS for %s', async (_label, account, matches) => {
      accounts.findById.mockResolvedValue(account);
      passwords.verify.mockResolvedValue(matches);

      await expect(service.change('user-1', change, CLIENT)).rejects.toMatchObject({
        errorCode: ErrorCode.INVALID_CREDENTIALS,
        message: 'The current password is incorrect.',
      });
      expect(passwords.verify).toHaveBeenCalledWith('old-password', account?.passwordHash ?? null);
      expect(accounts.setPasswordHash).not.toHaveBeenCalled();
    });
  });

  describe('triggerReset (api-design 14)', () => {
    it("emails a PASSWORD_RESET code to the account's own email and audits the trigger (BR-35)", async () => {
      await expect(service.triggerReset(STAFF, 'user-1', CLIENT)).resolves.toBeUndefined();

      expect(codes.assertCooldown).not.toHaveBeenCalled();
      expect(codes.issue).toHaveBeenCalledWith('user-1', OtpPurpose.PASSWORD_RESET, NOW, tx);
      expect(accounts.insertAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          type: AuthEventType.PASSWORD_RESET_REQUESTED,
        }),
        tx,
      );
      expect(events.emitAfterCommit).toHaveBeenCalledWith(AUDIT_RECORD, {
        actorId: 'staff-1',
        actorRoles: ['STAFF'],
        organizationId: null,
        action: 'account.triggerReset',
        subjectType: 'Account',
        subjectId: 'user-1',
        ip: CLIENT.ip,
      });
      expect(mail.send).toHaveBeenCalledWith(
        codeEmail('staff@treklink.vn', OtpPurpose.PASSWORD_RESET, ISSUED),
      );
    });

    it.each([
      ['an unknown account', null],
      ['a soft-deleted account', anAccount({ deletedAt: NOW })],
    ])('answers 404 for %s', async (_label, account) => {
      accounts.findById.mockResolvedValue(account);

      await expect(service.triggerReset(STAFF, 'user-9', CLIENT)).rejects.toMatchObject({
        errorCode: ErrorCode.NOT_FOUND,
        message: 'Account not found.',
      });
      expect(mail.send).not.toHaveBeenCalled();
    });
  });
});
