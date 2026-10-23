import { Global, Module } from '@nestjs/common';
import { ACCOUNT_CONTEXT_PROVIDER } from '../auth';
import { MembersRepository } from './members.repository';
import { OrganizationAccountContextProvider } from './providers/account-context.provider';

// The ports `organizations` provides to lower modules (platform design §2.1). Global, and exporting
// only the port tokens, because `auth` cannot import `organizations`: `organizations` imports `auth`.
// API_KEY_RESOLVER and ORGANIZATION_EXIT_CHECKS join with the rest of task 1.3.
@Global()
@Module({
  providers: [
    MembersRepository,
    { provide: ACCOUNT_CONTEXT_PROVIDER, useClass: OrganizationAccountContextProvider },
  ],
  exports: [ACCOUNT_CONTEXT_PROVIDER],
})
export class OrganizationsPortsModule {}
