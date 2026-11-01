import { Controller, Get, Query } from '@nestjs/common';
import { CheckPolicies } from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import {
  SystemHealthQueryDto,
  SystemHealthService,
  type SystemHealthView,
} from './system-health.service';

// `GET /api/system-health` (api-design 06): TrekLink Admin only, through `systemHealth.read`.
@Controller('system-health')
export class SystemHealthController {
  constructor(private readonly health: SystemHealthService) {}

  @Get()
  @CheckPolicies((ability) => ability.can('read', 'SystemHealth'))
  @ResponseMessage('OK')
  report(@Query() query: SystemHealthQueryDto): Promise<SystemHealthView> {
    return this.health.report(query);
  }
}
