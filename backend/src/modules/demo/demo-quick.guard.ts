import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Caller } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { simulationDatabaseAllowed } from '../platform/config/database-url';
import { ValidatedEnvironment } from '../platform/config/environment-variables';

@Injectable()
export class DemoQuickGuard {
  constructor(private readonly config: ConfigService<ValidatedEnvironment, true>) {}

  enabled(): boolean {
    return (
      this.config.get('DEMO_CONTROLS_ENABLED', { infer: true }) === true &&
      ['sandbox', 'staging'].includes(
        this.config.get('VITE_APP_ENV', { infer: true })?.trim().toLowerCase(),
      )
    );
  }

  assert(caller: Caller): void {
    if (!caller.roles.includes('ADMIN') || caller.organizationId !== null)
      throw new DomainException(
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
        'TrekLink Admin access is required.',
      );
    if (!this.enabled())
      throw new DomainException(
        HttpStatus.FORBIDDEN,
        ErrorCode.DEMO_DISABLED,
        'Demo quick controls are disabled.',
      );
    if (!simulationDatabaseAllowed(this.config))
      throw new DomainException(
        HttpStatus.FORBIDDEN,
        ErrorCode.DEMO_DATABASE_NOT_ALLOWED,
        'Demo quick controls require a local or staging database.',
      );
  }
}
