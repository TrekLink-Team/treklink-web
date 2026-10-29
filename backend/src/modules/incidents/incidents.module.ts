import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { AlertDeliveriesRepository } from './alert-deliveries.repository';
import { AuthorityReportsRepository } from './authority-reports.repository';
import { IncidentsRepository } from './incidents.repository';
import { IncidentLifecycle } from './incident-lifecycle';
import { IncidentsPortsModule } from './incidents-ports.module';
import { IncidentsService } from './incidents.service';

// Repositories remain private. IncidentsService serves this module's controllers (task 6.1);
// exported domain services join in the later incident tasks.
@Module({
  imports: [PlatformModule, IncidentsPortsModule],
  providers: [
    IncidentsRepository,
    AlertDeliveriesRepository,
    AuthorityReportsRepository,
    IncidentLifecycle,
    IncidentsService,
  ],
})
export class IncidentsModule {}
