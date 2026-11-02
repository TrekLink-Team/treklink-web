import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainException, ErrorCode } from '../../common/errors';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { isLoopbackDatabaseUrl } from './demo-guard.service';

// The database of the Vercel staging (D-094), the name `backend/scripts/vercel-build.sh` requires before
// it migrates and seeds.
export const STAGING_DATABASE = 'treklink_prod';

// The database name of a Postgres URL: its path without the leading slash, decoded once; null for a
// string that does not parse as a URL.
export const databaseNameOf = (databaseUrl: string): string | null => {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return null;
  }
  const name = url.pathname.replace(/^\//, '');
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
};

// REQ-SIM-02: a loopback database (the same test as the control panel, design §2) or one named
// `treklink_prod`. The shared Neon `dev` database of D-062 is neither.
export const isSimulationDatabaseUrl = (databaseUrl: string): boolean =>
  isLoopbackDatabaseUrl(databaseUrl) || databaseNameOf(databaseUrl) === STAGING_DATABASE;

// The database check of every field simulation write (specs/demo/design.md §9). `NODE_ENV` is not
// checked, because the staging runs as production; the simulation never truncates or deletes a row, so
// the control panel's guards of §2 do not apply to it.
@Injectable()
export class DemoSimulationGuard {
  constructor(private readonly config: ConfigService<ValidatedEnvironment, true>) {}

  // Both connections: the backend's (DATABASE_URL) and the one `prisma migrate` uses.
  databaseAllowed(): boolean {
    return (
      isSimulationDatabaseUrl(this.config.get('DATABASE_URL', { infer: true })) &&
      isSimulationDatabaseUrl(this.config.get('DATABASE_DIRECT_URL', { infer: true }))
    );
  }

  assertAllowed(): void {
    if (!this.databaseAllowed())
      throw new DomainException(
        HttpStatus.FORBIDDEN,
        ErrorCode.DEMO_DATABASE_NOT_ALLOWED,
        'The field simulation runs only on a local database or the Vercel staging.',
      );
  }
}
