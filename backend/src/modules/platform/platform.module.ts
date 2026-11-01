import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR, DiscoveryModule } from '@nestjs/core';
import { AuditLogController } from './audit/audit-log.controller';
import { AuditLogRepository } from './audit/audit-log.repository';
import { AuditLogService } from './audit/audit-log.service';
import { ParameterReadsService } from './parameters/parameter-reads.service';
import { ParametersController } from './parameters/parameters.controller';
import { AuditSinkListener } from './audit/audit-sink.listener';
import { TransactionalEvents } from './events/emit-after-commit';
import { HealthController } from './health/health.controller';
import { HealthService } from './health/health.service';
import { ParameterRepository } from './parameters/parameter.repository';
import { ParameterService } from './parameters/parameter.service';
import { JobRunnerService } from './scheduler/job-runner.service';
import { JobTickInterceptor } from './scheduler/job-tick.interceptor';

// Cross-cutting backend foundation (D-028). Depends on no other module
// (specs/platform/requirements.md §1, "Depends on").
@Module({
  imports: [DiscoveryModule],
  controllers: [HealthController, ParametersController, AuditLogController],
  providers: [
    HealthService,
    TransactionalEvents,
    AuditSinkListener,
    ParameterRepository,
    ParameterService,
    JobRunnerService,
    { provide: APP_INTERCEPTOR, useClass: JobTickInterceptor },
    ParameterReadsService,
    AuditLogRepository,
    AuditLogService,
  ],
  exports: [TransactionalEvents, ParameterService],
})
export class PlatformModule {}
