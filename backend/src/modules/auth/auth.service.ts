import { HttpStatus, Injectable } from '@nestjs/common';
import { AuthEventType } from '@prisma/client';
import { DomainException, ErrorCode } from '../../common/errors';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
import { AccountSessionService, SessionUser } from './account-session.service';
import { Account, AccountsRepository, normalizeEmail } from './accounts.repository';
import { PasswordService } from './password.service';
import { ClientInfo, TokenPair, TokenService } from './token.service';

export interface Credentials {
  email: string;
  password: string;
}

export type SignInResult = TokenPair & { user: SessionUser };

const MINUTE_MS = 60_000;

// One message for an unknown email, a wrong password and an account that may not sign in, so the
// response never says which field was wrong (REQ-ERR-01, MSG09).
export const invalidCredentials = () =>
  new DomainException(
    HttpStatus.UNAUTHORIZED,
    ErrorCode.INVALID_CREDENTIALS,
    'Incorrect email or password. Please try again.',
  );

const accountLocked = (minutes: number) =>
  new DomainException(
    HttpStatus.LOCKED,
    ErrorCode.ACCOUNT_LOCKED,
    `Too many attempts. Try again in ${minutes} minutes.`,
  );

// Sign-in, refresh, sign-out and the current account (auth tasks 2.2 and 6.1, api-design 01 to 04).
@Injectable()
export class AuthService {
  constructor(
    private readonly accounts: AccountsRepository,
    private readonly sessions: AccountSessionService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly parameters: ParameterService,
    private readonly events: TransactionalEvents,
  ) {}

  async login(credentials: Credentials, client: ClientInfo): Promise<SignInResult> {
    const email = normalizeEmail(credentials.email);
    const account = await this.accounts.findByEmail(email);
    const now = new Date();

    // REQ-STA-01: a locked account is refused before its password is checked.
    if (account?.lockedUntil && account.lockedUntil > now) {
      await this.recordEvent(account.id, email, AuthEventType.LOGIN_FAILED, client);
      throw accountLocked(Math.ceil((account.lockedUntil.getTime() - now.getTime()) / MINUTE_MS));
    }

    const passwordMatches = await this.passwords.verify(
      credentials.password,
      account?.passwordHash ?? null,
    );
    const user = passwordMatches && account ? await this.sessions.eligible(account) : null;
    if (!account || !user) return this.rejectLogin(account, email, client, now);

    return this.events.transaction(async (tx) => {
      await this.accounts.recordLoginSuccess(user.id, now, tx);
      await this.accounts.insertAuthEvent(
        { userId: user.id, email, type: AuthEventType.LOGIN_SUCCEEDED, ...client },
        tx,
      );
      const { tokens } = await this.tokens.issue(user, client, tx);
      return { ...tokens, user };
    });
  }

  refresh(refreshToken: string, client: ClientInfo): Promise<TokenPair> {
    return this.tokens.refresh(refreshToken, client);
  }

  logout(userId: string, refreshToken: string, client: ClientInfo): Promise<void> {
    return this.tokens.logout(userId, refreshToken, client);
  }

  async me(userId: string): Promise<SessionUser> {
    const user = await this.sessions.load(userId);
    if (!user) {
      throw new DomainException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.UNAUTHENTICATED,
        'Authentication required.',
      );
    }
    return user;
  }

  // Records the failure and locks the account once auth.loginMaxFailures failures fall inside
  // auth.loginFailureWindowMinutes (REQ-STA-01). Failures before the last sign-in or the end of the
  // last lock do not count again.
  private async rejectLogin(
    account: Account | null,
    email: string,
    client: ClientInfo,
    now: Date,
  ): Promise<never> {
    if (!account) {
      await this.recordEvent(null, email, AuthEventType.LOGIN_FAILED, client);
      throw invalidCredentials();
    }

    const [maxFailures, windowMinutes, lockoutMinutes] = await Promise.all([
      this.parameters.get('auth.loginMaxFailures'),
      this.parameters.get('auth.loginFailureWindowMinutes'),
      this.parameters.get('auth.lockoutMinutes'),
    ]);
    const since = new Date(
      Math.max(
        now.getTime() - windowMinutes * MINUTE_MS,
        account.lockedUntil?.getTime() ?? 0,
        account.lastLoginAt?.getTime() ?? 0,
      ),
    );

    const locked = await this.events.transaction(async (tx) => {
      await this.accounts.insertAuthEvent(
        { userId: account.id, email, type: AuthEventType.LOGIN_FAILED, ...client },
        tx,
      );
      const failures = await this.accounts.countLoginFailuresSince(account.id, since, tx);
      const lockNow = failures >= maxFailures;
      await this.accounts.recordLoginFailure(
        account.id,
        failures,
        lockNow ? new Date(now.getTime() + lockoutMinutes * MINUTE_MS) : null,
        tx,
      );
      if (lockNow) {
        await this.accounts.insertAuthEvent(
          { userId: account.id, email, type: AuthEventType.ACCOUNT_LOCKED, ...client },
          tx,
        );
      }
      return lockNow;
    });

    throw locked ? accountLocked(lockoutMinutes) : invalidCredentials();
  }

  private recordEvent(
    userId: string | null,
    email: string,
    type: AuthEventType,
    client: ClientInfo,
  ): Promise<void> {
    return this.accounts.insertAuthEvent({ userId, email, type, ...client });
  }
}
