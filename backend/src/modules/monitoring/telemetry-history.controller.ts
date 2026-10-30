import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { IsDate, IsEnum, IsIn, IsOptional } from 'class-validator';
import {
  Caller,
  CheckPolicies,
  CurrentAbility,
  CurrentCaller,
  type PolicyAbility,
} from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { HISTORY_KINDS, type HistoryKind } from '../gateway-sync';
import { HistoryDto, HistoryService } from './history.service';

const asArray = ({ value }: { value: unknown }) => (typeof value === 'string' ? [value] : value);

// api-design 03: `from` inclusive, `to` exclusive; the service checks the order and the span.
export class HistoryQueryDto {
  @Type(() => Date)
  @IsDate()
  from!: Date;

  @Type(() => Date)
  @IsDate()
  to!: Date;

  @IsOptional()
  @Transform(asArray)
  @IsEnum(HISTORY_KINDS, { each: true })
  kind?: HistoryKind[];

  @IsOptional()
  @IsIn(['json', 'csv'])
  format?: 'json' | 'csv';
}

// A device's position and telemetry history (task 3.3, api-design 03, UC-40). The route needs
// `read TelemetryHistory`: `telemetryHistory.read` for Staff and Admin, `telemetryHistory.read.own` for
// Org Manager and Org Operator, whom the service narrows to the periods their organization held the
// device. An organization API key cannot reach it (no `@AuthOneOf`).
@Controller('telemetry/devices')
export class TelemetryHistoryController {
  constructor(private readonly history: HistoryService) {}

  @Get(':id/history')
  @CheckPolicies((ability) => ability.can('read', 'TelemetryHistory'))
  @ResponseMessage('OK')
  async get(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: HistoryQueryDto,
    @CurrentCaller() caller: Caller,
    @CurrentAbility() ability: PolicyAbility,
  ): Promise<HistoryDto | string> {
    const history = await this.history.history(id, query, caller, ability);
    return query.format === 'csv' ? this.history.csv(history) : history;
  }
}
