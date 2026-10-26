import { Global, Module } from '@nestjs/common';
import { CONTRACT_DIRECTORY } from '../billing';
import { OrganizationsModule } from '../organizations';
import { ContractsRepository } from './contracts.repository';
import { RentalsContractDirectory } from './providers/contract-directory.provider';

// The ports `rentals` provides to lower modules (platform design §2.1): CONTRACT_DIRECTORY for
// `billing`. Global and exporting only the token, because `billing` cannot import `rentals`.
@Global()
@Module({
  imports: [OrganizationsModule],
  providers: [
    ContractsRepository,
    { provide: CONTRACT_DIRECTORY, useClass: RentalsContractDirectory },
  ],
  exports: [CONTRACT_DIRECTORY],
})
export class RentalsPortsModule {}
