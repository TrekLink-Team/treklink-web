import { Module } from '@nestjs/common';
import { AuditSinkListener } from './audit/audit-sink.listener';
import { TransactionalEvents } from './events/emit-after-commit';
import { HealthController } from './health/health.controller';
import { HealthService } from './health/health.service';

// Cross-cutting backend foundation (D-028). Depends on no other module
// (specs/platform/requirements.md §1, "Depends on").
@Module({
  controllers: [HealthController],
  providers: [HealthService, TransactionalEvents, AuditSinkListener],
  exports: [TransactionalEvents],
})
export class PlatformModule {}
