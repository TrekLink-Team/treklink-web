import { OtpPurpose, Prisma } from '@prisma/client';
import { ErrorCode } from '../../common/errors';
import { ParameterService } from '../platform/parameters/parameter.service';
import { AccountsRepository } from './accounts.repository';
import { hashCode, OneTimeCodeService } from './one-time-code.service';

const NOW = new Date('2026-10-24T03:00:00.000Z');
const tx = { tx: true } as unknown as Prisma.TransactionClient;

const PARAMETERS: Record<string, number> = {
  'auth.resetCodeTtlMinutes': 10,
  'auth.invitationTtlHours': 72,
  'auth.codeMaxAttempts': 5,
  'auth.codeResendCooldownSeconds': 60,
};

const liveCode = (overrides: Record<string, unknown> = {}) => ({
  id: 'otp-1',
  codeHash: hashCode('482913'),
  attempts: 0,
  expiresAt: new Date(NOW.getTime() + 60_000),
  ...overrides,
});

describe('OneTimeCodeService', () => {
  let accounts: Record<string, jest.Mock>;
  let parameters: { get: jest.Mock };
  let service: OneTimeCodeService;

  beforeEach(() => {
    accounts = {
      lastCodeSentAt: jest.fn().mockResolvedValue(null),
      consumeLiveCodes: jest.fn().mockResolvedValue(undefined),
      createCode: jest.fn().mockResolvedValue(undefined),
      findLiveCode: jest.fn().mockResolvedValue(liveCode()),
      countCodeAttempt: jest.fn().mockResolvedValue(undefined),
    };
    parameters = { get: jest.fn((key: string) => Promise.resolve(PARAMETERS[key])) };
    service = new OneTimeCodeService(
      accounts as unknown as AccountsRepository,
      parameters as unknown as ParameterService,
    );
  });

  describe('assertCooldown', () => {
    it('lets an account that was never sent a code ask for one', async () => {
      await expect(service.assertCooldown('user-1', NOW)).resolves.toBeUndefined();
      expect(parameters.get).not.toHaveBeenCalled();
    });

    it('answers 429 OTP_COOLDOWN one second before auth.codeResendCooldownSeconds ends (REQ-ERR-08)', async () => {
      accounts.lastCodeSentAt.mockResolvedValue(new Date(NOW.getTime() - 59_000));

      await expect(service.assertCooldown('user-1', NOW)).rejects.toMatchObject({
        errorCode: ErrorCode.OTP_COOLDOWN,
        message: 'Please wait a minute before requesting another code.',
      });
    });

    it('lets the account ask again once the cooldown has passed', async () => {
      accounts.lastCodeSentAt.mockResolvedValue(new Date(NOW.getTime() - 60_000));

      await expect(service.assertCooldown('user-1', NOW)).resolves.toBeUndefined();
    });
  });

  describe('issue', () => {
    it.each([
      [OtpPurpose.PASSWORD_RESET, 10 * 60_000],
      [OtpPurpose.SET_PASSWORD, 72 * 3_600_000],
    ])(
      'stores only the hash of a six-digit %s code and spends the earlier ones',
      async (purpose, lifetimeMs) => {
        const issued = await service.issue('user-1', purpose, NOW, tx);

        expect(issued.code).toMatch(/^\d{6}$/);
        expect(issued.lifetimeMs).toBe(lifetimeMs);
        expect(accounts.consumeLiveCodes).toHaveBeenCalledWith('user-1', purpose, NOW, tx);
        expect(accounts.createCode).toHaveBeenCalledWith(
          {
            userId: 'user-1',
            purpose,
            codeHash: hashCode(issued.code),
            expiresAt: new Date(NOW.getTime() + lifetimeMs),
          },
          tx,
        );
        expect(accounts.consumeLiveCodes.mock.invocationCallOrder[0]).toBeLessThan(
          accounts.createCode.mock.invocationCallOrder[0],
        );
      },
    );
  });

  describe('verify', () => {
    it('returns the id of a matching live code without counting an attempt', async () => {
      await expect(
        service.verify('user-1', OtpPurpose.PASSWORD_RESET, '482913', NOW),
      ).resolves.toBe('otp-1');
      expect(accounts.findLiveCode).toHaveBeenCalledWith('user-1', OtpPurpose.PASSWORD_RESET);
      expect(accounts.countCodeAttempt).not.toHaveBeenCalled();
    });

    it('refuses with MSG08 when no live code exists (consumed or never sent)', async () => {
      accounts.findLiveCode.mockResolvedValue(null);

      await expect(
        service.verify('user-1', OtpPurpose.PASSWORD_RESET, '482913', NOW),
      ).rejects.toMatchObject({
        errorCode: ErrorCode.CODE_INVALID,
        message: 'This code is invalid or has expired. Request a new one.',
      });
      expect(accounts.countCodeAttempt).not.toHaveBeenCalled();
    });

    it.each([
      ['a wrong code', liveCode(), '000000'],
      ['a code of another length', liveCode(), '48291'],
      ['an expired code', liveCode({ expiresAt: NOW }), '482913'],
      ['a code out of attempts', liveCode({ attempts: 5 }), '482913'],
    ])('refuses %s and counts the attempt (REQ-ERR-03)', async (_label, row, code) => {
      accounts.findLiveCode.mockResolvedValue(row);

      await expect(
        service.verify('user-1', OtpPurpose.PASSWORD_RESET, code, NOW),
      ).rejects.toMatchObject({ errorCode: ErrorCode.CODE_INVALID });
      expect(accounts.countCodeAttempt).toHaveBeenCalledWith('otp-1');
    });
  });
});
