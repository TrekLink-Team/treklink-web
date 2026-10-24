import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Caller, CheckPolicies, CurrentCaller } from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { PagedResult } from '../../common/dto/paging';
import { AccountView } from './accounts.repository';
import { AccountsService } from './accounts.service';
import { clientInfo } from './auth.controller';
import {
  AccountListQueryDto,
  CreateAccountDto,
  DeactivateAccountDto,
  UpdateAccountDto,
} from './dto/auth.dto';
import { PasswordFlowsService } from './password-flows.service';

const canManageAccounts = CheckPolicies((ability) => ability.can('manage', 'Account'));

// Account administration (auth task 6.1, api-design 09 to 14). TrekLink Admin only
// (`account.manage`), except the Staff-triggered reset of api-design 14 (`account.triggerReset`).
@Controller('accounts')
export class AccountsController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly passwords: PasswordFlowsService,
  ) {}

  @Get()
  @canManageAccounts
  @ResponseMessage('OK')
  list(@Query() query: AccountListQueryDto): Promise<PagedResult<AccountView>> {
    return this.accounts.list({
      ...query,
      isActive: query.isActive === undefined ? undefined : query.isActive === 'true',
    });
  }

  @Post()
  @canManageAccounts
  @ResponseMessage('Account created, invitation sent')
  create(
    @Body() dto: CreateAccountDto,
    @CurrentCaller() caller: Caller,
    @Ip() ip: string | undefined,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<AccountView> {
    return this.accounts.create(caller, dto, clientInfo(ip, userAgent));
  }

  @Patch(':id')
  @canManageAccounts
  @ResponseMessage('Account updated')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAccountDto,
    @CurrentCaller() caller: Caller,
    @Ip() ip: string | undefined,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<AccountView> {
    return this.accounts.update(caller, id, dto, clientInfo(ip, userAgent));
  }

  @Post(':id/deactivate')
  @canManageAccounts
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Account deactivated')
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeactivateAccountDto,
    @CurrentCaller() caller: Caller,
    @Ip() ip: string | undefined,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<AccountView> {
    return this.accounts.deactivate(caller, id, dto.reason, clientInfo(ip, userAgent));
  }

  @Post(':id/reactivate')
  @canManageAccounts
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Account reactivated')
  reactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentCaller() caller: Caller,
    @Ip() ip: string | undefined,
    @Headers('user-agent') userAgent: string | undefined,
  ): Promise<AccountView> {
    return this.accounts.reactivate(caller, id, clientInfo(ip, userAgent));
  }

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
