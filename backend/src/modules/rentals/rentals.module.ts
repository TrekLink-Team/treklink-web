import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { ContractLifecycleService } from './contract-lifecycle.service';
import { ContractsRepository } from './contracts.repository';
import { ContractsService } from './contracts.service';

// Rental contracts (specs/rentals/design.md). Phase 1: the repository, the lifecycle and the port
// behaviours; the controllers and the MF-01 services join with Phase 2.
@Module({
  imports: [PlatformModule],
  providers: [ContractsRepository, ContractLifecycleService, ContractsService],
  exports: [ContractLifecycleService, ContractsService],
})
export class RentalsModule {}
