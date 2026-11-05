import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { Caller, CheckPolicies, CurrentCaller } from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { VariantRow } from './devices.repository';
import { DevicesService } from './devices.service';
import { CreateVariantDto, UpdateVariantDto } from './dto/variant.dto';
import { VariantWithCount } from './variants.repository';
import { VariantsService } from './variants.service';

export class VariantQueryDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  @IsBoolean()
  includeInactive?: boolean;
}

// devices api-design 01 to 04 (tasks 2.1 and 4.1). The list serves the register form, the maintenance
// checklist and screen 4.1: TrekLink Staff hold `hardwareVariant.read`, the Org Manager
// `hardwareVariant.read.org`, and only an Admin may include inactive variants. Create, edit and delete
// are the Admin's `hardwareVariant.manage` (screen 4.1). The global JwtAuthGuard and PoliciesGuard
// apply to every route (D-061).
@Controller('hardware-variants')
export class VariantsController {
  constructor(
    private readonly devices: DevicesService,
    private readonly variants: VariantsService,
  ) {}

  @Get()
  @CheckPolicies((ability) => ability.can('read', 'HardwareVariant'))
  @ResponseMessage('OK')
  list(@Query() query: VariantQueryDto, @CurrentCaller() caller: Caller): Promise<VariantRow[]> {
    const all = query.includeInactive === true && caller.roles.includes('ADMIN');
    return this.devices.variantCatalog(!all);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @CheckPolicies((ability) => ability.can('create', 'HardwareVariant'))
  @ResponseMessage('Saved.')
  create(
    @Body() dto: CreateVariantDto,
    @CurrentCaller() caller: Caller,
  ): Promise<VariantWithCount> {
    return this.variants.create(dto, caller);
  }

  @Patch(':id')
  @CheckPolicies((ability) => ability.can('update', 'HardwareVariant'))
  @ResponseMessage('Saved.')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVariantDto,
    @CurrentCaller() caller: Caller,
  ): Promise<VariantWithCount> {
    return this.variants.update(id, dto, caller);
  }

  @Delete(':id')
  @CheckPolicies((ability) => ability.can('delete', 'HardwareVariant'))
  @ResponseMessage('Deleted')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentCaller() caller: Caller,
  ): Promise<null> {
    await this.variants.remove(id, caller);
    return null;
  }
}
