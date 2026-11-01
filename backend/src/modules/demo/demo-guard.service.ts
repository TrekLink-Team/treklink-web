import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainException, ErrorCode } from '../../common/errors';
import { ValidatedEnvironment } from '../platform/config/environment-variables';

const IPV4_LOOPBACK = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

// True for `localhost`, an IPv4 address in 127.0.0.0/8 and `::1`; false for any other host and for a
// string that does not parse as a URL. The case it exists for is a Neon host (`*.neon.tech`, D-062).
export const isLoopbackDatabaseUrl = (databaseUrl: string): boolean => {
  let host: string;
  try {
    host = new URL(databaseUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === 'localhost') return true;
  if (host === '[::1]' || host === '::1') return true;
  const v4 = IPV4_LOOPBACK.exec(host);
  return v4 !== null && v4.slice(1).every((octet) => Number(octet) <= 255);
};

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
      databaseLocal: isLoopbackDatabaseUrl(this.config.get('DATABASE_URL', { infer: true })),
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
