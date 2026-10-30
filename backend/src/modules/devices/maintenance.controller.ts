import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Caller, CheckPolicies, CurrentCaller } from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { PagedResult, pagingBoundsFrom, resolvePage, toPagedResult } from '../../common/dto/paging';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { parseDay, RecordView } from './device-view';
import {
  CompleteMaintenanceDto,
  DecideMaintenanceDto,
  EstimateMaintenanceDto,
  MaintenanceQueryDto,
  OpenMaintenanceDto,
} from './dto/maintenance.dto';
import { MaintenanceService } from './maintenance.service';

// devices api-design 15: the page of records plus the approval threshold, so Staff see the amount
// beside the estimate without the Admin-only parameters endpoint.
export interface MaintenanceRecordPage extends PagedResult<RecordView> {
  approvalThresholdVnd: number;
}

// devices api-design 11 to 15 (tasks 2.8 and 4.1). Staff open, estimate and complete with
// `device.operate`; Staff and Admin list with `device.read`; an Admin decides a cost with
// `maintenance.decide`. Each mutation runs in one transaction.
@Controller()
export class MaintenanceController {
  constructor(
    private readonly maintenance: MaintenanceService,
    private readonly events: TransactionalEvents,
    private readonly config: ConfigService<ValidatedEnvironment, true>,
  ) {}

  @Post('devices/:id/maintenance')
  @CheckPolicies((ability) => ability.can('operate', 'Device'))
  @ResponseMessage('Maintenance opened')
  open(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OpenMaintenanceDto,
    @CurrentCaller() caller: Caller,
  ) {
    return this.events.transaction((tx) =>
      this.maintenance.open(id, dto, caller.id, new Date(), tx),
    );
  }

  @Patch('devices/:id/maintenance/:recordId/estimate')
  @CheckPolicies((ability) => ability.can('operate', 'Device'))
  @ResponseMessage('Estimate recorded')
  estimate(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('recordId', ParseUUIDPipe) recordId: string,
    @Body() dto: EstimateMaintenanceDto,
    @CurrentCaller() caller: Caller,
  ): Promise<RecordView> {
    return this.events.transaction((tx) =>
      this.maintenance.estimate(id, recordId, dto, caller.id, tx),
    );
  }

  @Post('devices/:id/maintenance/:recordId/decision')
  @HttpCode(HttpStatus.OK)
  @CheckPolicies((ability) => ability.can('decide', 'MaintenanceRecord'))
  @ResponseMessage('Maintenance cost decided')
  decide(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('recordId', ParseUUIDPipe) recordId: string,
    @Body() dto: DecideMaintenanceDto,
    @CurrentCaller() caller: Caller,
  ): Promise<RecordView> {
    return this.events.transaction((tx) =>
      this.maintenance.decide(id, recordId, dto, caller.id, new Date(), tx),
    );
  }

  @Patch('devices/:id/maintenance/:recordId')
  @CheckPolicies((ability) => ability.can('operate', 'Device'))
  @ResponseMessage('Maintenance updated')
  complete(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('recordId', ParseUUIDPipe) recordId: string,
    @Body() dto: CompleteMaintenanceDto,
    @CurrentCaller() caller: Caller,
  ): Promise<RecordView> {
    return this.events.transaction((tx) =>
      this.maintenance.complete(id, recordId, dto, caller.id, new Date(), tx),
    );
  }

  @Get('maintenance-records')
  @CheckPolicies((ability) => ability.can('read', 'Device'))
  @ResponseMessage('OK')
  async list(@Query() query: MaintenanceQueryDto): Promise<MaintenanceRecordPage> {
    const page = resolvePage(
      query,
      pagingBoundsFrom({
        DEFAULT_PAGE_SIZE: this.config.get('DEFAULT_PAGE_SIZE', { infer: true }),
        MAX_PAGE_SIZE: this.config.get('MAX_PAGE_SIZE', { infer: true }),
      }),
    );
    const [[rows, total], approvalThresholdVnd] = await Promise.all([
      this.maintenance.page(
        {
          statuses: query.status,
          reasons: query.reason,
          expectedBy: query.dueBefore ? parseDay(query.dueBefore) : undefined,
        },
        page.skip,
        page.take,
      ),
      this.maintenance.approvalThresholdVnd(),
    ]);
    return { ...toPagedResult(rows, total, page), approvalThresholdVnd };
  }
}
