import { Controller, Get, Query } from '@nestjs/common';
import { CheckPolicies } from '../../../common/decorators/access.decorator';
import { ResponseMessage } from '../../../common/decorators/response-message.decorator';
import { AuditLogQueryDto } from './audit-log-query.dto';
import { AuditLogService } from './audit-log.service';

// The generic audit log (task 4.2, api-design 05, UC-58). TrekLink Admin only: `auditLog.read`.
@Controller('audit-logs')
@CheckPolicies((ability) => ability.can('read', 'AuditLog'))
export class AuditLogController {
  constructor(private readonly auditLog: AuditLogService) {}

  @Get()
  @ResponseMessage('OK')
  search(@Query() query: AuditLogQueryDto) {
    return this.auditLog.search(query);
  }
}
