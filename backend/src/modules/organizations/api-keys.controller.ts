import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { Caller, CheckPolicies, CurrentCaller } from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './dto/api-keys.dto';

// Organization API keys (api-design 20 to 22). The Org Manager holds `apiKey.manage.own` and does
// everything on its own organization; TrekLink Staff and Admin hold `apiKey.read` and only list
// (ruling 2026-10-30). The organization scope is checked in the service.
@Controller('organizations/:id/api-keys')
export class ApiKeysController {
  constructor(private readonly keys: ApiKeysService) {}

  @Get()
  @CheckPolicies((ability) => ability.can('read', 'ApiKey'))
  @ResponseMessage('OK')
  list(@Param('id', ParseUUIDPipe) id: string, @CurrentCaller() caller: Caller) {
    return this.keys.list(id, caller);
  }

  @Post()
  @CheckPolicies((ability) => ability.can('create', 'ApiKey'))
  @ResponseMessage('API key created. Copy it now; it will not be shown again.')
  create(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateApiKeyDto,
    @CurrentCaller() caller: Caller,
  ) {
    return this.keys.create(id, dto.name, caller);
  }

  @Post(':keyId/revoke')
  @HttpCode(HttpStatus.OK)
  @CheckPolicies((ability) => ability.can('revoke', 'ApiKey'))
  @ResponseMessage('API key revoked')
  revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('keyId', ParseUUIDPipe) keyId: string,
    @CurrentCaller() caller: Caller,
  ) {
    return this.keys.revoke(id, keyId, caller);
  }
}
