import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Caller, CheckPolicies, CurrentCaller } from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { PagedResult } from '../../common/dto/paging';
import {
  ConfirmLossDto,
  DecideLossDto,
  LossCaseQueryDto,
  RecoverLossDto,
  ReportLossDto,
  TriageLossDto,
} from './dto/loss-case.dto';
import { LossCaseDto, LossCaseService } from './loss-cases.service';

// devices api-design 17 to 22 and 27 (task 2.7, UC-49, UC-60). Permissions (catalog,
// migration 20261031120100_permission_loss_case): `lossCase.report` for Staff and
// `lossCase.report.own` for the Org Manager on the report; `lossCase.read` and `lossCase.read.own` on
// the reads, scoped to the caller's organization by the service; `lossCase.operate` for triage,
// recovery and confirmation; `lossCase.decide` for the Admin settlement. The global JwtAuthGuard and
// PoliciesGuard apply to every route (D-061).
@Controller()
export class LossCasesController {
  constructor(private readonly lossCases: LossCaseService) {}

  @Post('devices/:id/loss-cases')
  @HttpCode(HttpStatus.CREATED)
  @CheckPolicies((ability) => ability.can('report', 'LossCase'))
  @ResponseMessage('Loss reported. TrekLink will contact you.')
  report(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReportLossDto,
    @CurrentCaller() caller: Caller,
  ): Promise<LossCaseDto> {
    return this.lossCases.report(id, dto, caller);
  }

  @Get('loss-cases')
  @CheckPolicies((ability) => ability.can('read', 'LossCase'))
  @ResponseMessage('OK')
  list(
    @Query() query: LossCaseQueryDto,
    @CurrentCaller() caller: Caller,
  ): Promise<PagedResult<LossCaseDto>> {
    return this.lossCases.list(query, caller);
  }

  @Get('loss-cases/:id')
  @CheckPolicies((ability) => ability.can('read', 'LossCase'))
  @ResponseMessage('OK')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentCaller() caller: Caller,
  ): Promise<LossCaseDto> {
    return this.lossCases.get(id, caller);
  }

  @Post('loss-cases/:id/triage')
  @HttpCode(HttpStatus.OK)
  @CheckPolicies((ability) => ability.can('operate', 'LossCase'))
  @ResponseMessage('Loss case triaged')
  triage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TriageLossDto,
    @CurrentCaller() caller: Caller,
  ): Promise<LossCaseDto> {
    return this.lossCases.triage(id, dto, caller);
  }

  @Post('loss-cases/:id/recover')
  @HttpCode(HttpStatus.OK)
  @CheckPolicies((ability) => ability.can('operate', 'LossCase'))
  @ResponseMessage('Device recovered')
  recover(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecoverLossDto,
    @CurrentCaller() caller: Caller,
  ): Promise<LossCaseDto> {
    return this.lossCases.recover(id, dto, caller);
  }

  @Post('loss-cases/:id/confirm')
  @HttpCode(HttpStatus.OK)
  @CheckPolicies((ability) => ability.can('operate', 'LossCase'))
  @ResponseMessage('Loss confirmed')
  confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmLossDto,
    @CurrentCaller() caller: Caller,
  ): Promise<LossCaseDto> {
    return this.lossCases.confirm(id, dto, caller);
  }

  @Post('loss-cases/:id/decision')
  @HttpCode(HttpStatus.OK)
  @CheckPolicies((ability) => ability.can('decide', 'LossCase'))
  @ResponseMessage('Loss case settled')
  decide(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideLossDto,
    @CurrentCaller() caller: Caller,
  ): Promise<LossCaseDto> {
    return this.lossCases.decide(id, dto, caller);
  }
}
