import { Controller, Get, Query } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { Caller, CheckPolicies, CurrentCaller } from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { VariantRow } from './devices.repository';
import { DevicesService } from './devices.service';

export class VariantQueryDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  @IsBoolean()
  includeInactive?: boolean;
}

// devices api-design 01 (task 4.1 part): the hardware variants for the register form and the
// maintenance checklist (screens 4.2 and 4.3). TrekLink Staff hold `hardwareVariant.read`, the Org
// Manager `hardwareVariant.read.org`; only an Admin may include inactive variants. Create, edit and
// delete join with task 2.1.
@Controller('hardware-variants')
export class VariantsController {
  constructor(private readonly devices: DevicesService) {}

  @Get()
  @CheckPolicies((ability) => ability.can('read', 'HardwareVariant'))
  @ResponseMessage('OK')
  list(@Query() query: VariantQueryDto, @CurrentCaller() caller: Caller): Promise<VariantRow[]> {
    const all = query.includeInactive === true && caller.roles.includes('ADMIN');
    return this.devices.variantCatalog(!all);
  }
}
