import { Controller, Get, Query } from '@nestjs/common';
import { IsIn, IsOptional, IsUUID, ValidateIf } from 'class-validator';
import { Caller, CheckPolicies, CurrentCaller } from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { PagedQueryDto } from '../../common/dto/paging';
import type { UnitState } from './custody-view';
import { RentedDevicesService } from './rented-devices.service';

export class RentedDevicesQueryDto extends PagedQueryDto {
  @IsOptional()
  @IsUUID()
  contractId?: string;

  @IsOptional()
  @ValidateIf((_query, value) => value !== 'none')
  @IsUUID()
  groupId?: string;

  @IsOptional()
  @IsIn(['LIVE', 'OFFLINE', 'NOT_HEARD'])
  state?: UnitState;
}

@Controller('rented-devices')
export class RentedDevicesController {
  constructor(private readonly rentedDevices: RentedDevicesService) {}

  @Get()
  @CheckPolicies((ability) => ability.can('read', 'RentalContract'))
  @ResponseMessage('OK')
  list(@Query() query: RentedDevicesQueryDto, @CurrentCaller() caller: Caller) {
    return this.rentedDevices.list(query, caller);
  }
}
