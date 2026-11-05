import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { Caller, CheckPolicies, CurrentCaller } from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { PagedResult } from '../../common/dto/paging';
import { RunStockTakeDto, StockTakeQueryDto } from './dto/stock-take.dto';
import { StockTakeRun, StockTakeService, StockTakeSummary } from './stock-take.service';

// devices api-design 25 and 26 (tasks 2.6 and 4.1, screen 4.5). TrekLink Staff and Admin hold
// `stockTake.manage`; the global JwtAuthGuard and PoliciesGuard apply to every route (D-061).
@Controller('stock-takes')
export class StockTakesController {
  constructor(private readonly stockTakes: StockTakeService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @CheckPolicies((ability) => ability.can('create', 'StockTake'))
  @ResponseMessage('Stock-take recorded')
  run(@Body() dto: RunStockTakeDto, @CurrentCaller() caller: Caller): Promise<StockTakeRun> {
    return this.stockTakes.run(dto, caller);
  }

  @Get()
  @CheckPolicies((ability) => ability.can('read', 'StockTake'))
  @ResponseMessage('OK')
  list(@Query() query: StockTakeQueryDto): Promise<PagedResult<StockTakeSummary>> {
    return this.stockTakes.list(query);
  }
}
