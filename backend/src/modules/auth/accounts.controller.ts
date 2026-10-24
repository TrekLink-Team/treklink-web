import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { Caller, CheckPolicies, CurrentCaller } from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { clientInfo } from './auth.controller';
import { PasswordFlowsService } from './password-flows.service';

// Account administration (auth task 6.1, api-design 09 to 14). Only the Staff-triggered reset of
// api-design 14 is built here (US-UC09); task 5.1 adds the rest of the routes (US-UC10).
@Controller('accounts')
export class AccountsController {
  constructor(private readonly passwords: PasswordFlowsService) {}

  @Post(':id/password-reset')
  @CheckPolicies((ability) => ability.can('triggerReset', 'Account'))
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Reset code sent to the account email')
  async triggerPasswordReset(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentCaller() caller: Caller,
    @Ip() ip: string | undefined,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<null> {
    await this.passwords.triggerReset(caller, id, clientInfo(ip, userAgent));
    return null;
  }
}
