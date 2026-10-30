import { Global, Module } from '@nestjs/common';
import { CONTRACT_DIRECTORY } from '../billing';
import { CUSTODY_RESOLVER } from '../devices';
import { OrganizationsModule } from '../organizations';
import { ContractsRepository } from './contracts.repository';
import { RentalsContractDirectory } from './providers/contract-directory.provider';
import { RentalsCustodyResolver } from './providers/custody-resolver.provider';

// The ports `rentals` provides to lower modules (platform design §2.1): CONTRACT_DIRECTORY for
// `billing` and CUSTODY_RESOLVER for `devices` (task 1.3). Global and exporting only the tokens,
// because neither `billing` nor `devices` can import `rentals`. LOSS_CASE_LISTENERS is an array
// `devices` exports, so RentalsModule registers its listener there instead.
@Global()
@Module({
  imports: [OrganizationsModule],
  providers: [
    ContractsRepository,
    { provide: CONTRACT_DIRECTORY, useClass: RentalsContractDirectory },
    { provide: CUSTODY_RESOLVER, useClass: RentalsCustodyResolver },
  ],
  exports: [CONTRACT_DIRECTORY, CUSTODY_RESOLVER],
})
export class RentalsPortsModule {}
