import { Module } from '@nestjs/common';
import { BillingModule } from '../billing';
import { DevicesModule } from '../devices';
import { OrganizationsModule } from '../organizations';
import { PlatformModule } from '../platform/platform.module';
import { ContractDecisionsService } from './contract-decisions.service';
import { ContractLifecycleService } from './contract-lifecycle.service';
import { ContractNotificationsListener } from './contract-notifications.listener';
import { ContractReadsService } from './contract-reads.service';
import { ContractsController } from './contracts.controller';
import { ContractsRepository } from './contracts.repository';
import { ContractsService } from './contracts.service';
import { HandoverController } from './handover.controller';
import { HandoverService } from './handover.service';
import { RentalsLossCaseListener } from './providers/loss-case-listener.provider';
import { RentalsOrganizationExitCheck } from './providers/organization-exit-check.provider';
import { RentalsPortsModule } from './rentals-ports.module';
import { ReturnController } from './return.controller';
import { OverdueAndDefaultJob } from './overdue-and-default.job';
import { ReplacementService } from './replacement.service';
import { ReservationRemindersJob } from './reservation-reminders.job';
import { ReturnService } from './return.service';
import { TermRolloverJob } from './term-rollover.job';

// Rental contracts (specs/rentals/design.md). Phase 1: the repository, the lifecycle and the port
// behaviours; Phase 2 so far: the request, approval, rejection and cancellation (tasks 2.1, 2.2);
// the counter handover (tasks 2.3, 2.4); the reads of task 5.1 and their endpoints; billing's
// CONTRACT_DIRECTORY and CUSTODY_RESOLVER (RentalsPortsModule), the ORGANIZATION_EXIT_CHECKS check
// and the LOSS_CASE_LISTENERS listener (task 1.3); MF-05: the term rollover job (3.1), check-in, inspection and close (4.1, 4.2, 4.4).
// Replacement (4.3) and the overdue and default job (3.2) join with their tasks.
@Module({
  imports: [PlatformModule, OrganizationsModule, BillingModule, DevicesModule, RentalsPortsModule],
  controllers: [ContractsController, HandoverController, ReturnController],
  providers: [
    ContractsRepository,
    ContractLifecycleService,
    ContractNotificationsListener,
    ContractsService,
    ContractReadsService,
    ContractDecisionsService,
    RentalsLossCaseListener,
    HandoverService,
    ReturnService,
    ReplacementService,
    OverdueAndDefaultJob,
    ReservationRemindersJob,
    TermRolloverJob,
    RentalsOrganizationExitCheck,
  ],
  exports: [ContractLifecycleService, ContractsService],
})
export class RentalsModule {}
