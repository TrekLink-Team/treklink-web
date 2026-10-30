import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ACCOUNT_DIRECTORY, STAFF_NOTIFICATIONS } from '../platform/ports';
import { AccountsRepository } from './accounts.repository';
import { createMailPort } from './mail/mail.factory';
import { MAIL_PORT } from './mail/mail.port';
import { AuthAccountDirectory } from './providers/account-directory.provider';
import { AuthStaffNotifications } from './providers/staff-notifications.provider';

// Auth-owned providers for the platform ports: actor names and Staff operational email. The shared
// mail transport is created once here and remains available through AuthModule's re-export.
// Global scope exports port tokens only, because lower modules cannot import auth.
@Global()
@Module({
  providers: [
    AccountsRepository,
    { provide: ACCOUNT_DIRECTORY, useClass: AuthAccountDirectory },
    { provide: MAIL_PORT, inject: [ConfigService], useFactory: createMailPort },
    { provide: STAFF_NOTIFICATIONS, useClass: AuthStaffNotifications },
  ],
  exports: [ACCOUNT_DIRECTORY, MAIL_PORT, STAFF_NOTIFICATIONS],
})
export class AuthPortsModule {}
