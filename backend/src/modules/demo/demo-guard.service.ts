import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainException, ErrorCode } from '../../common/errors';
import { isLoopbackDatabaseUrl } from '../platform/config/database-url';
import { ValidatedEnvironment } from '../platform/config/environment-variables';

// The URL checks are pure and live in platform, so the field simulation of gateway-sync runs the same
// test without a gateway-sync to demo edge (specs/demo/design.md §9).
export { isLoopbackDatabaseUrl } from '../platform/config/database-url';

export interface DemoFacts {
  enabled: boolean;
  databaseLocal: boolean;
}

// The checks every demo action passes, in order (specs/demo/design.md §2): not production (403
// DEMO_DISABLED), a loopback database (403 DEMO_DATABASE_NOT_LOCAL), one action at a time (409
// DEMO_BUSY). The lock is an in-process flag: a demo laptop runs one backend.
@Injectable()
export class DemoGuardService {
  private busy = false;

  constructor(private readonly config: ConfigService<ValidatedEnvironment, true>) {}

  facts(): DemoFacts {
    return {
      enabled: this.config.get('NODE_ENV', { infer: true }) !== 'production',
      // Both connections: the backend's (DATABASE_URL) and the one `prisma migrate` uses.
      databaseLocal:
        isLoopbackDatabaseUrl(this.config.get('DATABASE_URL', { infer: true })) &&
        isLoopbackDatabaseUrl(this.config.get('DATABASE_DIRECT_URL', { infer: true })),
    };
  }

  // Runs `work` once the three checks pass, holding the lock until it settles.
  async run<T>(work: () => Promise<T>): Promise<T> {
    const { enabled, databaseLocal } = this.facts();
    if (!enabled) {
      throw new DomainException(
        HttpStatus.FORBIDDEN,
        ErrorCode.DEMO_DISABLED,
        'Demo controls are disabled in production.',
      );
    }
    if (!databaseLocal) {
      throw new DomainException(
        HttpStatus.FORBIDDEN,
        ErrorCode.DEMO_DATABASE_NOT_LOCAL,
        'Demo controls run only against a local database.',
      );
    }
    if (this.busy) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        ErrorCode.DEMO_BUSY,
        'A demo action is already running. Try again in a moment.',
      );
    }
    this.busy = true;
    try {
      return await work();
    } finally {
      this.busy = false;
    }
  }
}
