import { Global, Module } from '@nestjs/common';
import { CONTRACT_CLOSE_CHECKS } from '../rentals';
import { IncidentsRepository } from './incidents.repository';
import { IncidentsCloseCheck } from './providers/contract-close-check.provider';
import { IncidentsOrganizationCount } from './providers/organization-count.provider';

// The ports `incidents` provides to `rentals` (platform design §2.1, Figure 3 "provides
// CONTRACT_CLOSE_CHECKS"). Global and exporting only the token, because `rentals` cannot import
// `incidents`. The token is a multi-provider: this module is its only contributor so far.
@Global()
@Module({
  providers: [
    IncidentsRepository,
    IncidentsCloseCheck,
    IncidentsOrganizationCount,
    {
      provide: CONTRACT_CLOSE_CHECKS,
      useFactory: (incidents: IncidentsCloseCheck) => [incidents],
      inject: [IncidentsCloseCheck],
    },
  ],
  exports: [CONTRACT_CLOSE_CHECKS],
})
export class IncidentsPortsModule {}
