import { createHash, randomInt, timingSafeEqual } from 'crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { OtpPurpose, Prisma } from '@prisma/client';
import { DomainException, ErrorCode } from '../../common/errors';
import { ParameterService } from '../platform/parameters/parameter.service';
import { AccountsRepository } from './accounts.repository';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

export const hashCode = (code: string): string => createHash('sha256').update(code).digest('hex');

// MSG08: one answer for a wrong, expired, used or exhausted code (REQ-ERR-03).
export const codeInvalid = () =>
  new DomainException(
    HttpStatus.BAD_REQUEST,
    ErrorCode.CODE_INVALID,
    'This code is invalid or has expired. Request a new one.',
  );

const sameHash = (left: string, right: string): boolean => {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
};

export interface IssuedCode {
  code: string;
  lifetimeMs: number;
}

// Six-digit, single-use, time-limited codes for a password reset and an invitation (auth task 3.1,
// REQ-EVT-04, REQ-ERR-03, REQ-ERR-08). Only the SHA-256 of a code is stored. Sending a code spends
// the account's earlier live codes of that purpose, so only the newest works (treklink-docs#96, 6).
@Injectable()
export class OneTimeCodeService {
  constructor(
    private readonly accounts: AccountsRepository,
    private readonly parameters: ParameterService,
  ) {}

  // 429 OTP_COOLDOWN when the account was sent a code less than auth.codeResendCooldownSeconds ago.
  async assertCooldown(userId: string, now: Date): Promise<void> {
    const lastSent = await this.accounts.lastCodeSentAt(userId);
    if (!lastSent) return;
    const cooldownSeconds = await this.parameters.get('auth.codeResendCooldownSeconds');
    if (now.getTime() - lastSent.getTime() < cooldownSeconds * 1000) {
      throw new DomainException(
        HttpStatus.TOO_MANY_REQUESTS,
        ErrorCode.OTP_COOLDOWN,
        'Please wait a minute before requesting another code.',
      );
    }
  }

  // Stores a new code and returns it in plain form, for the email only.
  async issue(
    userId: string,
    purpose: OtpPurpose,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<IssuedCode> {
    const lifetimeMs =
      purpose === OtpPurpose.SET_PASSWORD
        ? (await this.parameters.get('auth.invitationTtlHours', tx)) * HOUR_MS
        : (await this.parameters.get('auth.resetCodeTtlMinutes', tx)) * MINUTE_MS;
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');

    await this.accounts.consumeLiveCodes(userId, purpose, now, tx);
    await this.accounts.createCode(
      {
        userId,
        purpose,
        codeHash: hashCode(code),
        expiresAt: new Date(now.getTime() + lifetimeMs),
      },
      tx,
    );
    return { code, lifetimeMs };
  }

  // Checks a submitted code against the newest live code of the purpose and returns its id, for the
  // caller to consume in its own transaction. The attempt is spent atomically before the comparison,
  // and the database refuses an expired or exhausted code, so concurrent guesses cannot all read the
  // same count (REQ-ERR-03). A correct code spends an attempt too; the spend is outside the caller's
  // transaction, so a rollback cannot give it back.
  async verify(userId: string, purpose: OtpPurpose, code: string, now: Date): Promise<string> {
    const row = await this.accounts.findLiveCode(userId, purpose);
    if (!row) throw codeInvalid();

    const maxAttempts = await this.parameters.get('auth.codeMaxAttempts');
    if (!(await this.accounts.spendAttempt(row.id, maxAttempts, now))) throw codeInvalid();
    if (!sameHash(hashCode(code), row.codeHash)) throw codeInvalid();
    return row.id;
  }
}
