import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CheckPolicies } from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import {
  PagedQueryDto,
  PagedResult,
  pagingBoundsFrom,
  resolvePage,
  toPagedResult,
} from '../../common/dto/paging';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { DeviceHistoryItem, DeviceHistoryService } from './device-history.service';

// monitoring api-design 07: a device's lifecycle history for TrekLink Staff and Admin, who hold
// `device.read` (the same permission as the device detail it sits beside, screen 4.2).
@Controller('devices')
export class DeviceHistoryController {
  constructor(
    private readonly history: DeviceHistoryService,
    private readonly config: ConfigService<ValidatedEnvironment, true>,
  ) {}

  @Get(':id/history')
  @CheckPolicies((ability) => ability.can('read', 'Device'))
  @ResponseMessage('OK')
  async list(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PagedQueryDto,
  ): Promise<PagedResult<DeviceHistoryItem>> {
    const page = resolvePage(
      query,
      pagingBoundsFrom({
        DEFAULT_PAGE_SIZE: this.config.get('DEFAULT_PAGE_SIZE', { infer: true }),
        MAX_PAGE_SIZE: this.config.get('MAX_PAGE_SIZE', { infer: true }),
      }),
    );
    const [items, total] = await this.history.history(id, page.skip, page.take);
    return toPagedResult(items, total, page);
  }
}
