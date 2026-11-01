import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainException, ErrorCode } from '../../common/errors';
import { ValidatedEnvironment } from '../platform/config/environment-variables';

const IPV4_LOOPBACK = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

// Query parameters that move a Postgres connection away from the URL's host. Prisma's Postgres driver
// connects to `host` when the query carries it (a socket directory or a host name), so
// `postgresql://u:p@localhost/db?host=ep-x.neon.tech` reaches Neon (review of treklink-web#245). The
// libpq names `hostaddr`, `service` and `servicefile` are refused too: a later driver or a tool reading
// the same variable may honour them.
export const TARGET_PARAMETERS: readonly string[] = ['host', 'hostaddr', 'service', 'servicefile'];

const decodeOnce = (text: string): string => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

// A query key as any parser could read it: trimmed and lower-cased, and decoded once more, so a
// double-encoded `%2568ost` counts as `host`. Refusing too much is safe here.
const keyForms = (key: string): string[] => {
  const plain = key.trim().toLowerCase();
  return [plain, decodeOnce(plain).trim().toLowerCase()];
};

// True only when the URL's host is `localhost`, an IPv4 address in 127.0.0.0/8 or `::1`, and its query
// carries no parameter that changes the connection target. False for anything else, including a
// string that does not parse as a URL. The case it exists for is a Neon host (`*.neon.tech`, D-062).
export const isLoopbackDatabaseUrl = (databaseUrl: string): boolean => {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return false;
  }
  for (const key of url.searchParams.keys()) {
    if (keyForms(key).some((form) => TARGET_PARAMETERS.includes(form))) return false;
  }
  const host = url.hostname.toLowerCase();
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
