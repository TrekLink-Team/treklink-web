import { Controller, Get, Query } from '@nestjs/common';
import { IsOptional, IsUUID } from 'class-validator';
import { CheckPolicies } from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { DevicesService } from './devices.service';

export class AvailabilityQueryDto {
  @IsOptional()
  @IsUUID()
  hardwareVariantId?: string;
}

// The first devices endpoint, devices api-design 24 (task 4.1 part), built by LongLP for screen 5.3.
// TrekLink Staff and Admin hold `device.availability`, the Org Manager `device.availability.org`;
// both are the readAvailability action on Device and see counts only, never a unit.
@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get('availability')
  @CheckPolicies((ability) => ability.can('readAvailability', 'Device'))
  @ResponseMessage('OK')
  availability(@Query() query: AvailabilityQueryDto) {
    return this.devices.availability(query.hardwareVariantId);
  }
}
