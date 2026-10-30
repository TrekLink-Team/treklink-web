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
import { ExpectedVersionDto, OrganizationReasonDto } from './dto/lifecycle.dto';
import { OrganizationStatusService } from './organization-status.service';

// Suspension, reactivation, closing and the status history (api-design 08 to 11). The Admin holds
// `organization.suspend` and `organization.decide`; Staff and Admin read any history
// (`organization.read`) and a Manager its own (`organization.read.own`, scope checked in the service).
@Controller('organizations')
export class OrganizationStatusController {
  constructor(private readonly status: OrganizationStatusService) {}

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @CheckPolicies((ability) => ability.can('suspend', 'Organization'))
  @ResponseMessage('Organization suspended')
  suspend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OrganizationReasonDto,
    @CurrentCaller() caller: Caller,
  ) {
    return this.status.suspend(id, dto.reason, dto.expectedVersion, caller);
  }

  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  @CheckPolicies((ability) => ability.can('suspend', 'Organization'))
  @ResponseMessage('Organization reactivated')
  reactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExpectedVersionDto,
    @CurrentCaller() caller: Caller,
  ) {
    return this.status.reactivate(id, dto.expectedVersion, caller);
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @CheckPolicies((ability) => ability.can('decide', 'Organization'))
  @ResponseMessage('Organization closed')
  close(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OrganizationReasonDto,
    @CurrentCaller() caller: Caller,
  ) {
    return this.status.close(id, dto.reason, dto.expectedVersion, caller);
  }

  @Get(':id/transitions')
  @CheckPolicies((ability) => ability.can('read', 'Organization'))
  @ResponseMessage('OK')
  transitions(@Param('id', ParseUUIDPipe) id: string, @CurrentCaller() caller: Caller) {
    return this.status.transitions(id, caller);
  }
}
