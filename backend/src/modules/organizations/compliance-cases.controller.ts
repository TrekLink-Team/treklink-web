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
import {
  Caller,
  CheckPolicies,
  CurrentAbility,
  CurrentCaller,
  PolicyAbility,
} from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { ComplianceCasesService } from './compliance-cases.service';
import {
  CloseComplianceCaseDto,
  ComplianceActionDto,
  ComplianceCaseQueryDto,
  OpenComplianceCaseDto,
} from './dto/compliance.dto';

// Compliance cases (api-design 28 to 32, screen 3.6): `complianceCase.manage`, TrekLink Staff and
// Admin. Suspending from a case also needs `organization.suspend` (Admin), checked in the service so
// Staff get the api-design 30 message.
@Controller()
export class ComplianceCasesController {
  constructor(private readonly cases: ComplianceCasesService) {}

  @Get('compliance-cases')
  @CheckPolicies((ability) => ability.can('manage', 'ComplianceCase'))
  @ResponseMessage('OK')
  page(@Query() query: ComplianceCaseQueryDto) {
    return this.cases.page(query);
  }

  @Get('compliance-cases/:id')
  @CheckPolicies((ability) => ability.can('manage', 'ComplianceCase'))
  @ResponseMessage('OK')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.cases.get(id);
  }

  @Post('organizations/:id/compliance-cases')
  @CheckPolicies((ability) => ability.can('manage', 'ComplianceCase'))
  @ResponseMessage('Compliance case opened')
  open(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OpenComplianceCaseDto,
    @CurrentCaller() caller: Caller,
  ) {
    return this.cases.open(
      id,
      {
        type: dto.type,
        evidence: dto.evidence.trim(),
        linkedContractIds: dto.linkedContractIds ?? [],
        linkedLossCaseIds: dto.linkedLossCaseIds ?? [],
      },
      caller,
    );
  }

  @Post('compliance-cases/:id/actions')
  @CheckPolicies((ability) => ability.can('manage', 'ComplianceCase'))
  @ResponseMessage('Action recorded')
  act(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ComplianceActionDto,
    @CurrentCaller() caller: Caller,
    @CurrentAbility() ability: PolicyAbility,
  ) {
    return this.cases.act(
      id,
      { kind: dto.kind, targetId: dto.targetId ?? null, note: dto.note.trim() },
      caller,
      ability.can('suspend', 'Organization'),
    );
  }

  @Post('compliance-cases/:id/close')
  @HttpCode(HttpStatus.OK)
  @CheckPolicies((ability) => ability.can('manage', 'ComplianceCase'))
  @ResponseMessage('Compliance case closed')
  close(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseComplianceCaseDto,
    @CurrentCaller() caller: Caller,
  ) {
    return this.cases.close(id, dto.outcome.trim(), dto.authorityReference ?? null, caller);
  }
}
