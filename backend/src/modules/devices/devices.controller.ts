import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { Caller, CheckPolicies, CurrentCaller } from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { DevicesService } from './devices.service';

export class AvailabilityQueryDto {
  @IsOptional()
  @IsUUID()
  hardwareVariantId?: string;
}

// devices api-design 10.
export class ResetDto {
  @IsBoolean()
  keyRemoved!: boolean;

  @IsBoolean()
  nodeDbCleared!: boolean;

  @IsBoolean()
  ownerCleared!: boolean;
}

// The first devices endpoint, devices api-design 24 (task 4.1 part), built by LongLP for screen 5.3.
// TrekLink Staff and Admin hold `device.availability`, the Org Manager `device.availability.org`;
// both are the readAvailability action on Device and see counts only, never a unit.
// devices api-design 10 (task 2.4 part, built by LongLP for MF-05): Staff record the reset of a
// returned unit at the counter (`device.operate`).
@Controller('devices')
export class DevicesController {
  constructor(
    private readonly devices: DevicesService,
    private readonly events: TransactionalEvents,
  ) {}

  @Post(':id/reset')
  @CheckPolicies((ability) => ability.can('operate', 'Device'))
  @ResponseMessage('Reset recorded')
  reset(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetDto,
    @CurrentCaller() caller: Caller,
  ) {
    return this.events.transaction((tx) => this.devices.reset(id, dto, caller.id, new Date(), tx));
  }

  @Get('availability')
  @CheckPolicies((ability) => ability.can('readAvailability', 'Device'))
  @ResponseMessage('OK')
  availability(@Query() query: AvailabilityQueryDto) {
    return this.devices.availability(query.hardwareVariantId);
  }
}
