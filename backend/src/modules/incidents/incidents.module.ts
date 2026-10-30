import { Module } from '@nestjs/common';
import { DevicesModule } from '../devices';
import { OrganizationsModule } from '../organizations';
import { PlatformModule } from '../platform/platform.module';
import { RentalsModule } from '../rentals';
import { AlertDeliveriesRepository } from './alert-deliveries.repository';
import { AlertDispatcherJob } from './alerts/alert-dispatcher.job';
import { AuthorityReportsRepository } from './authority-reports.repository';
import { IncidentIngress } from './incident-ingress';
import { IncidentLifecycle } from './incident-lifecycle';
import { IncidentsPortsModule } from './incidents-ports.module';
import { IncidentsQueryService } from './incidents-query.service';
import { IncidentsController } from './incidents.controller';
import { IncidentsRepository } from './incidents.repository';
import { IncidentsService } from './incidents.service';
import { RoutingService } from './routing.service';

// Repositories remain private. IncidentIngress is exported for gateway-sync's SOS hand-off (task 2.3),
// IncidentsQueryService for monitoring's `openByDevices`; the other monitoring reads join with task 5.1.
@Module({
  imports: [
    PlatformModule,
    IncidentsPortsModule,
    OrganizationsModule,
    RentalsModule,
    DevicesModule,
  ],
  controllers: [IncidentsController],
  providers: [
    IncidentsRepository,
    AlertDeliveriesRepository,
    AuthorityReportsRepository,
    IncidentLifecycle,
    IncidentsService,
    IncidentsQueryService,
    RoutingService,
    IncidentIngress,
    AlertDispatcherJob,
  ],
  exports: [IncidentIngress, IncidentsQueryService],
})
export class IncidentsModule {}
