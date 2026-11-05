import { Module } from '@nestjs/common';
import { ComplianceCasesService, OrganizationsModule } from '../organizations';
import { PlatformModule } from '../platform/platform.module';
import { DevicesController } from './devices.controller';
import { DevicesRepository } from './devices.repository';
import { DevicesService } from './devices.service';
import { IntakeService } from './intake.service';
import { LossSearchJob } from './jobs/loss-search.job';
import { LossCaseNotificationsListener } from './loss-case-notifications.listener';
import { LossCaseNotifier } from './loss-case-notifier';
import { LossCasesController } from './loss-cases.controller';
import { LossCasesRepository } from './loss-cases.repository';
import { LossCaseService } from './loss-cases.service';
import { MaintenanceController } from './maintenance.controller';
import { MaintenanceRepository } from './maintenance.repository';
import { MaintenanceService } from './maintenance.service';
import { LOSS_CASE_LISTENERS, LossCaseListener } from './ports/loss-case-listener.port';
import {
  LOSS_ORGANIZATION_ACTIONS,
  LossOrganizationActions,
} from './ports/loss-organization-actions.port';
import { DevicesComplianceLossCases } from './providers/compliance-loss-case.provider';
import { StockTakeService } from './stock-take.service';
import { StockTakesController } from './stock-takes.controller';
import { StockTakesRepository } from './stock-takes.repository';
import { VariantsController } from './variants.controller';
import { VariantsRepository } from './variants.repository';
import { VariantsService } from './variants.service';

// Hardware variants, devices and their lifecycle (specs/devices/design.md). Built so far: the
// projection side ingestion needs (tasks 1.1 and 2.5), the reservation reads of rentals, the fleet,
// detail and availability endpoints, the return side of MF-05 (markReturned, reset, inspection), the
// registration, intake check and maintenance records (tasks 2.2 and 2.8 parts), the variant catalog
// with its Admin writes (task 2.1), the stock-take (task 2.6), the LOSS_CASE_LISTENERS port (task 1.4),
// and loss cases (task 2.7) with the `devices.lossSearch` job. `organizations` gives
// the label of the organization whose key a unit carries (Figure 3 edge devices --> organizations).
// CUSTODY_RESOLVER comes from the global RentalsPortsModule (rentals task 1.3).
@Module({
  imports: [PlatformModule, OrganizationsModule],
  controllers: [
    DevicesController,
    MaintenanceController,
    VariantsController,
    LossCasesController,
    StockTakesController,
  ],
  providers: [
    DevicesRepository,
    DevicesService,
    MaintenanceRepository,
    MaintenanceService,
    IntakeService,
    VariantsRepository,
    VariantsService,
    StockTakesRepository,
    StockTakeService,
    // task 1.4: the one array billing and rentals add their listeners to (ports/loss-case-listener.port.ts).
    { provide: LOSS_CASE_LISTENERS, useFactory: (): LossCaseListener[] => [] },
    LossCaseNotifier,
    LossCasesRepository,
    LossCaseService,
    LossSearchJob,
    LossCaseNotificationsListener,
    // task 2.7: a suspected theft in renter custody opens or links a compliance case (design §3);
    // markKeyExposed is a direct ChannelKeyService call. The provider below gives organizations the loss
    // case codes of a case and the link of loss cases Staff name when they open one.
    {
      provide: LOSS_ORGANIZATION_ACTIONS,
      inject: [ComplianceCasesService],
      useFactory: (cases: ComplianceCasesService): LossOrganizationActions => ({
        openOrLinkComplianceCase: (input, tx) => cases.openOrLink(input, tx),
      }),
    },
    DevicesComplianceLossCases,
  ],
  exports: [DevicesService, LOSS_CASE_LISTENERS, LossCaseService, MaintenanceService],
})
export class DevicesModule {}
