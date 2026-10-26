import { Module } from '@nestjs/common';
import { BillingModule } from '../billing';
import { DevicesModule } from '../devices';
import { OrganizationsModule } from '../organizations';
import { PlatformModule } from '../platform/platform.module';
import { ContractDecisionsService } from './contract-decisions.service';
import { ContractLifecycleService } from './contract-lifecycle.service';
import { ContractReadsService } from './contract-reads.service';
import { ContractsController } from './contracts.controller';
import { ContractsRepository } from './contracts.repository';
import { ContractsService } from './contracts.service';
import { RentalsPortsModule } from './rentals-ports.module';

// Rental contracts (specs/rentals/design.md). Phase 1: the repository, the lifecycle and the port
// behaviours; Phase 2 so far: the request, approval, rejection and cancellation (tasks 2.1, 2.2);
// the reads of task 5.1 and their endpoints; billing's CONTRACT_DIRECTORY. The handover and
// end-of-contract services join with their tasks.
@Module({
  imports: [PlatformModule, OrganizationsModule, BillingModule, DevicesModule, RentalsPortsModule],
  controllers: [ContractsController],
  providers: [
    ContractsRepository,
    ContractLifecycleService,
    ContractsService,
    ContractReadsService,
    ContractDecisionsService,
  ],
  exports: [ContractLifecycleService, ContractsService],
})
export class RentalsModule {}
