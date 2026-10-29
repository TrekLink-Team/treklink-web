import { Controller, Get, Query } from '@nestjs/common';
import { CheckPolicies } from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { PagedResult } from '../../common/dto/paging';
import { AuthEventItem, AuthEventsService } from './auth-events.service';
import { AuthEventListQueryDto } from './dto/auth.dto';

// The authentication log (auth task 6.1, api-design 17, UC-58). TrekLink Admin only:
// `authEvent.read`; `organizationId` is a filter, never an authorization input.
@Controller('auth-events')
@CheckPolicies((ability) => ability.can('read', 'AuthEvent'))
export class AuthEventsController {
  constructor(private readonly authEvents: AuthEventsService) {}

  @Get()
  @ResponseMessage('OK')
  search(@Query() query: AuthEventListQueryDto): Promise<PagedResult<AuthEventItem>> {
    return this.authEvents.search(query);
  }
}
