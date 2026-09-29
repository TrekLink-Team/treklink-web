import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { HealthService } from './health/health.service';

// Cross-cutting backend foundation (D-028). Depends on no other module
// (specs/platform/requirements.md §1, "Depends on").
@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class PlatformModule {}
