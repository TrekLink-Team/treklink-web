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
import { IsBoolean, IsDate, IsOptional, IsString, MaxLength } from 'class-validator';
import { Caller, CheckPolicies, CurrentCaller } from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { PagedQueryDto, PagedResult } from '../../common/dto/paging';
import {
  AuthorityReportsService,
  AuthorityReportView,
  CloseCaseResult,
} from './authority-reports.service';

const NOTE_MAX = 2000;

export class AuthorityReportListQueryDto extends PagedQueryDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  open?: boolean;
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

// Task 6.1, api-design 09 and 11. Both need `authorityReport.manage` (TrekLink Staff and Admin).
// api-design 08 sits on IncidentsController, and 10 (a DEFAULTED contract) is not built yet.
@Controller('authority-reports')
export class AuthorityReportsController {
  constructor(private readonly reports: AuthorityReportsService) {}

  @Get()
  @CheckPolicies((ability) => ability.can('read', 'AuthorityReport'))
  @ResponseMessage('OK')
  list(@Query() query: AuthorityReportListQueryDto): Promise<PagedResult<AuthorityReportView>> {
    return this.reports.list(query);
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
