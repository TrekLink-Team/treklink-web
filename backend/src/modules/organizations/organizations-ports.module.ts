import { Global, Module } from '@nestjs/common';
import { ACCOUNT_CONTEXT_PROVIDER, API_KEY_RESOLVER } from '../auth';
import { ApiKeysRepository } from './api-keys.repository';
import { MembersRepository } from './members.repository';
import { OrganizationAccountContextProvider } from './providers/account-context.provider';
import { OrganizationApiKeyResolver } from './providers/api-key-resolver.provider';
import { ORGANIZATION_COUNTS, OrganizationCountProvider } from './ports/counts.port';
import { ORGANIZATION_EXIT_CHECKS, OrganizationExitCheck } from './ports/exit-checks.port';

// The ports `organizations` provides to lower modules (platform design §2.1). Global, and exporting
// only the port tokens, because `auth` cannot import `organizations`: `organizations` imports `auth`.
// ORGANIZATION_EXIT_CHECKS is the array `rentals` and `billing` add their checks to (task 2.4).
@Global()
@Module({
  providers: [
    MembersRepository,
    ApiKeysRepository,
    { provide: ACCOUNT_CONTEXT_PROVIDER, useClass: OrganizationAccountContextProvider },
    { provide: API_KEY_RESOLVER, useClass: OrganizationApiKeyResolver },
    // The array the providers of other modules add themselves to when their module starts.
    { provide: ORGANIZATION_EXIT_CHECKS, useValue: [] as OrganizationExitCheck[] },
    // The same for the counts of the organization detail (api-design 03).
    { provide: ORGANIZATION_COUNTS, useValue: [] as OrganizationCountProvider[] },
  ],
  exports: [
    ACCOUNT_CONTEXT_PROVIDER,
    API_KEY_RESOLVER,
    ORGANIZATION_EXIT_CHECKS,
    ORGANIZATION_COUNTS,
  ],
})
export class OrganizationsPortsModule {}
