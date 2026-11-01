import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthEventType } from '@prisma/client';
import { DomainException, ErrorCode } from '../../common/errors';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { AccountSessionService, SessionUser } from './account-session.service';
import { AccountsRepository } from './accounts.repository';
import type { SignInResult } from './auth.service';
import { ClientInfo, TokenService } from './token.service';

// The demo role switch (D-088, specs/demo/design.md §6): a normal token pair for a seeded account, issued
// as a sign-in issues it but without a password, and recorded as DEMO_SWITCH. Exported for the `demo`
// module only; it refuses unless DEMO_CONTROLS_ENABLED is true and NODE_ENV is not production, so no
// other caller can use it as a password bypass on a real deployment.
@Injectable()
export class DemoSessionService {
  constructor(
    private readonly accounts: AccountsRepository,
    private readonly sessions: AccountSessionService,
    private readonly tokens: TokenService,
    private readonly events: TransactionalEvents,
    private readonly config: ConfigService<ValidatedEnvironment, true>,
  ) {}

  // The seeded account behind an email as a session sees it, or null when it may not sign in. No token
  // is issued and nothing is recorded: the demo scenarios act as these accounts through the services.
  async accountOf(email: string): Promise<SessionUser | null> {
    this.assertEnabled();
    return this.eligibleByEmail(email);
  }

  async switchTo(email: string, client: ClientInfo): Promise<SignInResult> {
    this.assertEnabled();
    const user = await this.eligibleByEmail(email);
    if (!user) {
      throw new DomainException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'No seeded account for this role. Stage a scenario first.',
      );
    }
    return this.events.transaction(async (tx) => {
      await this.accounts.insertAuthEvent(
        { userId: user.id, email: user.email, type: AuthEventType.DEMO_SWITCH, ...client },
        tx,
      );
      const { tokens } = await this.tokens.issue(user, client, tx);
      return { ...tokens, user };
    });
  }

  private async eligibleByEmail(email: string): Promise<SessionUser | null> {
    const account = await this.accounts.findByEmail(email);
    return account ? this.sessions.eligible(account) : null;
  }

  private assertEnabled(): void {
    if (
      this.config.get('NODE_ENV', { infer: true }) === 'production' ||
      this.config.get('DEMO_CONTROLS_ENABLED', { infer: true }) !== true
    ) {
      throw new DomainException(
        HttpStatus.FORBIDDEN,
        ErrorCode.DEMO_DISABLED,
        'Demo controls are disabled.',
      );
    }
  }
}
