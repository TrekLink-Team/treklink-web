import { Global, Module } from '@nestjs/common';
import { CONTRACT_DIRECTORY, CREDIT_BASIS } from '../billing';
import { CUSTODY_RESOLVER } from '../devices';
import { OrganizationsModule } from '../organizations';
import { ContractsRepository } from './contracts.repository';
import { RentalsContractDirectory } from './providers/contract-directory.provider';
import { RentalsCreditBasis } from './providers/credit-basis.provider';
import { RentalsCustodyResolver } from './providers/custody-resolver.provider';

// The ports `rentals` provides to lower modules (platform design §2.1): CONTRACT_DIRECTORY and
// CREDIT_BASIS (service credits, billing task 8.1) for `billing` and CUSTODY_RESOLVER for `devices`
// (task 1.3). Global and exporting only the tokens, because neither `billing` nor `devices` can
// import `rentals`. LOSS_CASE_LISTENERS is an array `devices` exports, so RentalsModule registers its
// listener there instead.
@Global()
@Module({
  imports: [OrganizationsModule],
  providers: [
    ContractsRepository,
    { provide: CONTRACT_DIRECTORY, useClass: RentalsContractDirectory },
    { provide: CREDIT_BASIS, useClass: RentalsCreditBasis },
    { provide: CUSTODY_RESOLVER, useClass: RentalsCustodyResolver },
  ],
  exports: [CONTRACT_DIRECTORY, CREDIT_BASIS, CUSTODY_RESOLVER],
})
export class RentalsPortsModule {}
