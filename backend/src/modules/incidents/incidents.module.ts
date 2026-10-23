import { Module } from '@nestjs/common';
import { AlertDeliveriesRepository } from './alert-deliveries.repository';
import { AuthorityReportsRepository } from './authority-reports.repository';
import { IncidentsRepository } from './incidents.repository';

// Repositories remain private. Exported domain services join in the later incident tasks.
@Module({
  providers: [IncidentsRepository, AlertDeliveriesRepository, AuthorityReportsRepository],
})
export class IncidentsModule {}
