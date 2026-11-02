import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainException, ErrorCode } from '../../common/errors';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { simulationDatabaseAllowed } from '../platform/config/database-url';

export {
  STAGING_DATABASE,
  STAGING_REFUSED_PARAMETERS,
  databaseNameOf,
  isSimulationDatabaseUrl,
} from '../platform/config/database-url';

// The database check of every field simulation write (specs/demo/design.md §9). `NODE_ENV` is not
// checked, because the staging runs as production; the simulation never truncates or deletes a row, so
// the control panel's guards of §2 do not apply to it.
@Injectable()
export class DemoSimulationGuard {
  constructor(private readonly config: ConfigService<ValidatedEnvironment, true>) {}

  // Both connections: the backend's (DATABASE_URL) and the one `prisma migrate` uses.
  databaseAllowed(): boolean {
    return simulationDatabaseAllowed(this.config);
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
