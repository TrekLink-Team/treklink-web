import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { AuditLogRepository } from './audit/audit-log.repository';
import { AuditLogService } from './audit/audit-log.service';
import { ParameterReadsService } from './parameters/parameter-reads.service';
import { AuditSinkListener } from './audit/audit-sink.listener';
import { TransactionalEvents } from './events/emit-after-commit';
import { HealthController } from './health/health.controller';
import { HealthService } from './health/health.service';
import { ParameterRepository } from './parameters/parameter.repository';
import { ParameterService } from './parameters/parameter.service';
import { JobRunnerService } from './scheduler/job-runner.service';

// Cross-cutting backend foundation (D-028). Depends on no other module
// (specs/platform/requirements.md §1, "Depends on").
@Module({
  imports: [DiscoveryModule],
  controllers: [HealthController],
  providers: [
    HealthService,
    TransactionalEvents,
    AuditSinkListener,
    ParameterRepository,
    ParameterService,
    JobRunnerService,
    ParameterReadsService,
    AuditLogRepository,
    AuditLogService,
  ],
  exports: [TransactionalEvents, ParameterService],
})
export class PlatformModule {}
