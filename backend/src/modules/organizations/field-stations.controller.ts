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
import { CreateFieldStationDto, RevokeFieldStationDto } from './dto/field-stations.dto';
import { FieldStationsService } from './field-stations.service';

// Field Station credentials (api-design 23 to 26). The Org Manager holds `fieldStation.manage.own`, an
// Operator `fieldStation.read.own`, TrekLink Staff and Admin `fieldStation.read` and `fieldStation.revoke`.
// The organization scope is checked in the service. `release` is declared before the `:stationId`
// routes, so it is never read as a station id.
@Controller('organizations/:id/field-stations')
export class FieldStationsController {
  constructor(private readonly stations: FieldStationsService) {}

  @Get('release')
  @CheckPolicies((ability) => ability.can('read', 'FieldStation'))
  @ResponseMessage('OK')
  release(@Param('id', ParseUUIDPipe) id: string, @CurrentCaller() caller: Caller) {
    return this.stations.currentRelease(id, caller);
  }

  @Get()
  @CheckPolicies((ability) => ability.can('read', 'FieldStation'))
  @ResponseMessage('OK')
  list(@Param('id', ParseUUIDPipe) id: string, @CurrentCaller() caller: Caller) {
    return this.stations.list(id, caller);
  }

  @Post()
  @CheckPolicies((ability) => ability.can('create', 'FieldStation'))
  @ResponseMessage('Field Station credential created. Copy it now; it will not be shown again.')
  create(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateFieldStationDto,
    @CurrentCaller() caller: Caller,
  ) {
    return this.stations.create(id, dto.name, caller);
  }

  @Post(':stationId/revoke')
  @HttpCode(HttpStatus.OK)
  @CheckPolicies((ability) => ability.can('revoke', 'FieldStation'))
  @ResponseMessage('Field Station credential revoked')
  revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('stationId', ParseUUIDPipe) stationId: string,
    @Body() dto: RevokeFieldStationDto,
    @CurrentCaller() caller: Caller,
  ) {
    return this.stations.revoke(id, stationId, dto.reason || undefined, caller);
  }
}
