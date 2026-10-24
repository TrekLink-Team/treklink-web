import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { PlatformModule } from '../platform/platform.module';
import { AccountSessionService } from './account-session.service';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { AccountsRepository } from './accounts.repository';
import { AuthPortsModule } from './auth-ports.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AbilityFactory } from './casl/ability.factory';
import { PermissionCache } from './casl/permission-cache';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PoliciesGuard } from './guards/policies.guard';
import { createMailPort } from './mail/mail.factory';
import { MAIL_PORT } from './mail/mail.port';
import { OneTimeCodeService } from './one-time-code.service';
import { PasswordFlowsService } from './password-flows.service';
import { PasswordService } from './password.service';
import { PermissionsController, RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { TokenService } from './token.service';

// Identity, sessions and authorization (specs/auth/design.md). Depends on `platform` only; reads
// membership and API keys through the ports that `organizations` provides (design §2).
@Module({
  imports: [
    PlatformModule,
    AuthPortsModule,
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<ValidatedEnvironment, true>) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
        signOptions: {
          algorithm: 'HS256',
          expiresIn: config.get('JWT_ACCESS_TTL', { infer: true }),
        },
      }),
    }),
  ],
  controllers: [AuthController, AccountsController, RolesController, PermissionsController],
  providers: [
    AccountsRepository,
    AccountSessionService,
    PasswordService,
    TokenService,
    AuthService,
    OneTimeCodeService,
    PasswordFlowsService,
    AccountsService,
    RolesService,
    PermissionCache,
    AbilityFactory,
    JwtStrategy,
    JwtAuthGuard,
    PoliciesGuard,
    // Every route: token first, then policy (D-061). Order of registration is order of execution.
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
    { provide: APP_GUARD, useExisting: PoliciesGuard },
    { provide: MAIL_PORT, inject: [ConfigService], useFactory: createMailPort },
  ],
  exports: [JwtAuthGuard, PoliciesGuard, AbilityFactory, MAIL_PORT],
})
export class AuthModule {}
