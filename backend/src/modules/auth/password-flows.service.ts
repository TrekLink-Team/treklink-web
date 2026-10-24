import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { AuthEventType, OtpPurpose } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { AUDIT_RECORD, AuditRecordEvent } from '../platform/audit/audit-record.event';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { AccountSessionService } from './account-session.service';
import { Account, AccountsRepository, normalizeEmail } from './accounts.repository';
import { invalidCredentials, SignInResult } from './auth.service';
import { MAIL_PORT, MailMessage, MailPort } from './mail/mail.port';
import { codeInvalid, IssuedCode, OneTimeCodeService } from './one-time-code.service';
import { PasswordService } from './password.service';
import { ClientInfo, TokenService } from './token.service';

const MINUTE_MS = 60_000;

export interface CodeAndPassword {
  email: string;
  code: string;
  password: string;
}

export interface PasswordChange {
  currentPassword: string;
  newPassword: string;
}

// Only an active account that is not deleted is sent a code or may use one.
const canUseCodes = (account: Account | null): account is Account =>
  account !== null && account.isActive && account.deletedAt === null;

// The email that carries a code. It is the only place the plain code ever goes (AC-06).
export const codeEmail = (to: string, purpose: OtpPurpose, issued: IssuedCode): MailMessage => {
  const minutes = Math.round(issued.lifetimeMs / MINUTE_MS);
  const validity = minutes >= 120 ? `${Math.round(minutes / 60)} hours` : `${minutes} minutes`;
  return purpose === OtpPurpose.SET_PASSWORD
    ? {
        to,
        subject: 'Your TrekLink invitation code',
        text:
          `Your TrekLink invitation code is ${issued.code}. It is valid for ${validity}. ` +
          'Open TrekLink, choose "Set password" and enter it with your new password.',
      }
    : {
        to,
        subject: 'Your TrekLink password reset code',
        text:
          `Your TrekLink password reset code is ${issued.code}. It is valid for ${validity}. ` +
          'If you did not ask to reset your password, ignore this email.',
      };
};

// Forgot, reset, invitation, change and the Staff-triggered reset (auth task 3.2, api-design 05 to
// 08 and 14; REQ-EVT-04 to REQ-EVT-06, REQ-UBI-09, BR-35). No response and no log line written here
// holds a password or a code (AC-06).
@Injectable()
export class PasswordFlowsService {
  private readonly logger = new Logger(PasswordFlowsService.name);

  constructor(
    private readonly accounts: AccountsRepository,
    private readonly sessions: AccountSessionService,
    private readonly passwords: PasswordService,
    private readonly codes: OneTimeCodeService,
    private readonly tokens: TokenService,
    private readonly events: TransactionalEvents,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
  ) {}

  // api-design 05. The answer is the same for an unknown email and inside the cooldown, where nothing
  // is sent (FR-AUTH-05, D-063 rule 2). An account that never set a password is sent a SET_PASSWORD
  // code instead (D-059 rule 6).
  async forgot(email: string, client: ClientInfo): Promise<void> {
    const normalized = normalizeEmail(email);
    const account = await this.accounts.findByEmail(normalized);
    const knownUserId = account?.id ?? null;
    const now = new Date();

    if (!canUseCodes(account) || (await this.codes.inCooldown(account.id, now))) {
      await this.accounts.insertAuthEvent({
        userId: knownUserId,
        email: normalized,
        type: AuthEventType.PASSWORD_RESET_REQUESTED,
        ...client,
      });
      return;
    }

    const purpose = account.passwordHash ? OtpPurpose.PASSWORD_RESET : OtpPurpose.SET_PASSWORD;
    const issued = await this.events.transaction(async (tx) => {
      const code = await this.codes.issue(account.id, purpose, now, tx);
      await this.accounts.insertAuthEvent(
        {
          userId: account.id,
          email: normalized,
          type: AuthEventType.PASSWORD_RESET_REQUESTED,
          ...client,
        },
        tx,
      );
      return code;
    });
    // Not awaited: a known email must answer as fast as an unknown one once SMTP sends for real
    // (FR-AUTH-05). `sendCode` catches its own failure.
    void this.sendCode(account, purpose, issued);
  }

  // api-design 06: sets the password, spends the code and ends every session (REQ-EVT-05).
  async reset(input: CodeAndPassword, client: ClientInfo): Promise<void> {
    const account = await this.accounts.findByEmail(input.email);
    if (!canUseCodes(account)) throw codeInvalid();
    const now = new Date();

    const codeId = await this.codes.verify(account.id, OtpPurpose.PASSWORD_RESET, input.code, now);
    await this.passwords.assertPolicy(input.password);
    const passwordHash = await this.passwords.hash(input.password);

    await this.events.transaction(async (tx) => {
      if (!(await this.accounts.consumeCode(codeId, now, tx))) throw codeInvalid();
      await this.accounts.setPasswordHash(account.id, passwordHash, tx);
      await this.accounts.revokeAllUserTokens(account.id, now, tx);
      await this.accounts.insertAuthEvent(
        {
          userId: account.id,
          email: account.email,
          type: AuthEventType.PASSWORD_RESET_COMPLETED,
          ...client,
        },
        tx,
      );
    });
  }

  // api-design 07: the first password of an invited account, then a session (REQ-EVT-06). An account
  // that may not hold a session keeps the password and gets the login refusal (D-063 rule 5).
  async setPassword(input: CodeAndPassword, client: ClientInfo): Promise<SignInResult> {
    const account = await this.accounts.findByEmail(input.email);
    if (!canUseCodes(account)) throw codeInvalid();
    const now = new Date();

    const codeId = await this.codes.verify(account.id, OtpPurpose.SET_PASSWORD, input.code, now);
    await this.passwords.assertPolicy(input.password);
    const passwordHash = await this.passwords.hash(input.password);
    const user = await this.sessions.eligible({ ...account, passwordHash });

    const signedIn = await this.events.transaction(async (tx) => {
      if (!(await this.accounts.consumeCode(codeId, now, tx))) throw codeInvalid();
      await this.accounts.setPasswordHash(account.id, passwordHash, tx);
      await this.accounts.insertAuthEvent(
        { userId: account.id, email: account.email, type: AuthEventType.PASSWORD_SET, ...client },
        tx,
      );
      if (!user) return null;

      await this.accounts.recordLoginSuccess(user.id, now, tx);
      await this.accounts.insertAuthEvent(
        {
          userId: user.id,
          email: account.email,
          type: AuthEventType.LOGIN_SUCCEEDED,
          ...client,
        },
        tx,
      );
      const { tokens } = await this.tokens.issue(user, client, tx);
      return { ...tokens, user };
    });
    if (!signedIn) throw invalidCredentials();
    return signedIn;
  }

  // api-design 08: checks the current password, then ends every session of the account, the
  // caller's included (D-063 rule 1).
  async change(userId: string, input: PasswordChange, client: ClientInfo): Promise<void> {
    const account = await this.accounts.findById(userId);
    const matches = await this.passwords.verify(
      input.currentPassword,
      account?.passwordHash ?? null,
    );
    if (!account || !matches) {
      throw new DomainException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.INVALID_CREDENTIALS,
        'The current password is incorrect.',
      );
    }
    await this.passwords.assertPolicy(input.newPassword);
    const passwordHash = await this.passwords.hash(input.newPassword);
    const now = new Date();

    await this.events.transaction(async (tx) => {
      await this.accounts.setPasswordHash(account.id, passwordHash, tx);
      await this.accounts.revokeAllUserTokens(account.id, now, tx);
      await this.accounts.insertAuthEvent(
        { userId: account.id, email: account.email, type: AuthEventType.PASSWORD_SET, ...client },
        tx,
      );
    });
  }

  // api-design 14: Staff send a reset code to the account's own email and never see it (BR-35,
  // REQ-UBI-09). The resend cooldown answers 429 here (D-063 rule 7). A deactivated account is
  // refused, because reset would not accept its code (D-063 rule 8).
  async triggerReset(caller: Caller, accountId: string, client: ClientInfo): Promise<void> {
    const account = await this.accounts.findById(accountId);
    if (!account || account.deletedAt) {
      throw new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Account not found.');
    }
    if (!account.isActive) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        ErrorCode.INVALID_STATE_TRANSITION,
        'This account is deactivated. Reactivate it before sending a reset code.',
      );
    }
    const now = new Date();
    await this.codes.assertCooldown(account.id, now);

    const issued = await this.events.transaction(async (tx) => {
      const code = await this.codes.issue(account.id, OtpPurpose.PASSWORD_RESET, now, tx);
      await this.accounts.insertAuthEvent(
        {
          userId: account.id,
          email: account.email,
          type: AuthEventType.PASSWORD_RESET_REQUESTED,
          ...client,
        },
        tx,
      );
      this.events.emitAfterCommit(AUDIT_RECORD, {
        actorId: caller.id,
        actorRoles: caller.roles,
        organizationId: null,
        action: 'account.triggerReset',
        subjectType: 'Account',
        subjectId: account.id,
        ip: client.ip,
      } satisfies AuditRecordEvent);
      return code;
    });
    await this.sendCode(account, OtpPurpose.PASSWORD_RESET, issued);
  }

  // Emails a code. A failed send is logged without the code and does not change the answer, so a
  // known email still answers like an unknown one (FR-AUTH-05); the user asks for a new code after
  // the cooldown. AccountsService sends invitations through it too.
  async sendCode(
    account: Pick<Account, 'id' | 'email'>,
    purpose: OtpPurpose,
    issued: IssuedCode,
  ): Promise<void> {
    try {
      await this.mail.send(codeEmail(account.email, purpose, issued));
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'unknown error';
      this.logger.error(`Code email to account ${account.id} failed: ${reason}`);
    }
  }
}
