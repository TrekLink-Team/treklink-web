import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { AlertDeliveriesRepository } from './alert-deliveries.repository';
import { AuthorityReportsRepository } from './authority-reports.repository';
import { IncidentsRepository } from './incidents.repository';
import { IncidentLifecycle } from './incident-lifecycle';

// Repositories remain private. Exported domain services join in the later incident tasks.
@Module({
  imports: [PlatformModule],
  providers: [
    IncidentsRepository,
    AlertDeliveriesRepository,
    AuthorityReportsRepository,
    IncidentLifecycle,
  ],
})
export class IncidentsModule {}
