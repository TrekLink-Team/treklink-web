import { Global, Module } from '@nestjs/common';
import { ACCOUNT_CONTEXT_PROVIDER, API_KEY_RESOLVER } from '../auth';
import { ApiKeysRepository } from './api-keys.repository';
import { MembersRepository } from './members.repository';
import { OrganizationAccountContextProvider } from './providers/account-context.provider';
import { OrganizationApiKeyResolver } from './providers/api-key-resolver.provider';

// The ports `organizations` provides to lower modules (platform design §2.1). Global, and exporting
// only the port tokens, because `auth` cannot import `organizations`: `organizations` imports `auth`.
// ORGANIZATION_EXIT_CHECKS joins with the rest of task 1.3.
@Global()
@Module({
  providers: [
    MembersRepository,
    ApiKeysRepository,
    { provide: ACCOUNT_CONTEXT_PROVIDER, useClass: OrganizationAccountContextProvider },
    { provide: API_KEY_RESOLVER, useClass: OrganizationApiKeyResolver },
  ],
  exports: [ACCOUNT_CONTEXT_PROVIDER, API_KEY_RESOLVER],
})
export class OrganizationsPortsModule {}
