import { Controller, Get } from '@nestjs/common';
import { ResponseMessage } from '../../../common/decorators/response-message.decorator';
import { HealthReport, HealthService } from './health.service';

// Public by design: an orchestrator probes it without a token (api-design/01-get-health.md).
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @ResponseMessage('Healthy')
  check(): Promise<HealthReport> {
    return this.health.check();
  }
}
