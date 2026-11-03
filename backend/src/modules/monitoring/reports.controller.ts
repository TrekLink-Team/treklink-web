import { Controller, Get, Param, Query } from '@nestjs/common';
import { CheckPolicies } from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { ReportParamDto, ReportQueryDto, ReportsService, type ReportView } from './reports.service';

// `GET /api/reports/:kind` (api-design 08): TrekLink Staff and Admin, through `report.read` (Admin holds
// every Staff permission).
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get(':kind')
  @CheckPolicies((ability) => ability.can('read', 'Report'))
  @ResponseMessage('OK')
  async get(
    @Param() params: ReportParamDto,
    @Query() query: ReportQueryDto,
  ): Promise<ReportView | string> {
    const report = await this.reports.report(params.kind, query);
    return query.format === 'csv' ? this.reports.csv(report) : report;
  }
}
