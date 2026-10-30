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
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { Caller, CheckPolicies, CurrentCaller } from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { PagedQueryDto, PagedResult } from '../../common/dto/paging';
import {
  AuthorityReportsService,
  AuthorityReportView,
  CloseCaseResult,
} from './authority-reports.service';

const NOTE_MAX = 2000;
// The agency and reference bound of api-design 08 (IncidentsController), kept the same here.
const TEXT_MAX = 200;

export class AuthorityReportListQueryDto extends PagedQueryDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  open?: boolean;
}

export class ContractReportDto {
  @IsUUID()
  contractId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(TEXT_MAX)
  agency!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(TEXT_MAX)
  reference!: string;

  @Type(() => Date)
  @IsDate()
  reportedAt!: Date;

  @IsOptional()
  @IsString()
  @MaxLength(NOTE_MAX)
  note?: string;
}

export class CloseCaseDto {
  @Type(() => Date)
  @IsDate()
  closedAt!: Date;

  @IsOptional()
  @IsString()
  @MaxLength(NOTE_MAX)
  note?: string;
}

// Task 6.1, api-design 09 to 11. The list needs `read AuthorityReport`, the writes `manage
// AuthorityReport`; `authorityReport.manage` (TrekLink Staff and Admin) grants both. api-design 08
// sits on IncidentsController.
@Controller('authority-reports')
export class AuthorityReportsController {
  constructor(private readonly reports: AuthorityReportsService) {}

  @Get()
  @CheckPolicies((ability) => ability.can('read', 'AuthorityReport'))
  @ResponseMessage('OK')
  list(@Query() query: AuthorityReportListQueryDto): Promise<PagedResult<AuthorityReportView>> {
    return this.reports.list(query);
  }

  @Post()
  @CheckPolicies((ability) => ability.can('manage', 'AuthorityReport'))
  @ResponseMessage('Report recorded')
  reportContract(
    @Body() body: ContractReportDto,
    @CurrentCaller() caller: Caller,
  ): Promise<AuthorityReportView> {
    return this.reports.reportContract(body, caller);
  }

  @Post(':reportId/close-case')
  @HttpCode(HttpStatus.OK)
  @CheckPolicies((ability) => ability.can('manage', 'AuthorityReport'))
  @ResponseMessage('Case closed')
  closeCase(
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @Body() body: CloseCaseDto,
    @CurrentCaller() caller: Caller,
  ): Promise<CloseCaseResult> {
    return this.reports.closeCase(reportId, body, caller);
  }
}
