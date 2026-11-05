import { Global, Module } from '@nestjs/common';
import { CONTRACT_DIRECTORY, CREDIT_BASIS } from '../billing';
import { CUSTODY_RESOLVER, DEVICE_CONTRACTS } from '../devices';
import { OrganizationsModule } from '../organizations';
import { ContractsRepository } from './contracts.repository';
import { FaultReportsRepository } from './fault-reports.repository';
import { RentalsContractDirectory } from './providers/contract-directory.provider';
import { RentalsCreditBasis } from './providers/credit-basis.provider';
import { RentalsCustodyResolver } from './providers/custody-resolver.provider';
import { RentalsDeviceContracts } from './providers/device-contracts.provider';

// The ports `rentals` provides to lower modules (platform design §2.1): CONTRACT_DIRECTORY and
// CREDIT_BASIS (service credits, billing task 8.1) for `billing`, CUSTODY_RESOLVER for `devices`
// (task 1.3) and DEVICE_CONTRACTS for the device connector (task 11.1). Global and exporting only the tokens, because neither `billing` nor `devices` can
// import `rentals`. LOSS_CASE_LISTENERS is an array `devices` exports, so RentalsModule registers its
// listener there instead.
@Global()
@Module({
  imports: [OrganizationsModule],
  providers: [
    ContractsRepository,
    FaultReportsRepository,
    { provide: CONTRACT_DIRECTORY, useClass: RentalsContractDirectory },
    { provide: CREDIT_BASIS, useClass: RentalsCreditBasis },
    { provide: CUSTODY_RESOLVER, useClass: RentalsCustodyResolver },
    { provide: DEVICE_CONTRACTS, useClass: RentalsDeviceContracts },
  ],
  exports: [CONTRACT_DIRECTORY, CREDIT_BASIS, CUSTODY_RESOLVER, DEVICE_CONTRACTS],
})
export class RentalsPortsModule {}
