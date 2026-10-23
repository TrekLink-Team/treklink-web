import { Global, Module } from '@nestjs/common';
import { ACCOUNT_DIRECTORY } from '../platform/ports';
import { AccountsRepository } from './accounts.repository';
import { AuthAccountDirectory } from './providers/account-directory.provider';

// The ports `auth` provides to lower modules (platform design §2.1): ACCOUNT_DIRECTORY for `platform`.
// Global and exporting only the token, because `platform` cannot import `auth`.
@Global()
@Module({
  providers: [AccountsRepository, { provide: ACCOUNT_DIRECTORY, useClass: AuthAccountDirectory }],
  exports: [ACCOUNT_DIRECTORY],
})
export class AuthPortsModule {}
