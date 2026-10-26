import { Module } from '@nestjs/common';
import { BillingModule } from '../billing';
import { OrganizationsModule } from '../organizations';
import { PlatformModule } from '../platform/platform.module';
import { ContractLifecycleService } from './contract-lifecycle.service';
import { ContractsRepository } from './contracts.repository';
import { ContractsService } from './contracts.service';

// Rental contracts (specs/rentals/design.md). Phase 1: the repository, the lifecycle and the port
// behaviours; Phase 2 so far: the request (task 2.1). The controllers and the other MF-01 services
// join with their tasks.
@Module({
  imports: [PlatformModule, OrganizationsModule, BillingModule],
  providers: [ContractsRepository, ContractLifecycleService, ContractsService],
  exports: [ContractLifecycleService, ContractsService],
})
export class RentalsModule {}
