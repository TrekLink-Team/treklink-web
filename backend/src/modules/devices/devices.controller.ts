import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeviceStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Caller, CheckPolicies, CurrentCaller } from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import {
  PagedResult,
  PagedQueryDto,
  pagingBoundsFrom,
  resolvePage,
  toPagedResult,
} from '../../common/dto/paging';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { DeviceDetail, DevicesService, FleetDevice } from './devices.service';
import { IntakeCheckDto } from './dto/intake-check.dto';
import { IntakeService } from './intake.service';

// devices api-design 06; `status` repeats (`?status=AVAILABLE&status=RESERVED`).
export class DeviceQueryDto extends PagedQueryDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }): unknown[] =>
    Array.isArray(value) ? (value as unknown[]) : [value],
  )
  @IsEnum(DeviceStatus, { each: true })
  status?: DeviceStatus[];

  @IsOptional()
  @IsUUID()
  hardwareVariantId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  q?: string;
}

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
    private readonly intake: IntakeService,
    private readonly events: TransactionalEvents,
    private readonly config: ConfigService<ValidatedEnvironment, true>,
  ) {}

  // devices api-design 06 (task 4.1 part): the fleet for Staff and Admin (`device.read`), with the
  // last position and the organization whose key each unit carries.
  @Get()
  @CheckPolicies((ability) => ability.can('read', 'Device'))
  @ResponseMessage('OK')
  async list(@Query() query: DeviceQueryDto): Promise<PagedResult<FleetDevice>> {
    const page = resolvePage(
      query,
      pagingBoundsFrom({
        DEFAULT_PAGE_SIZE: this.config.get('DEFAULT_PAGE_SIZE', { infer: true }),
        MAX_PAGE_SIZE: this.config.get('MAX_PAGE_SIZE', { infer: true }),
      }),
    );
    const [rows, total] = await this.devices.fleetPage(
      {
        statuses: query.status,
        hardwareVariantId: query.hardwareVariantId,
        q: query.q?.trim() || undefined,
      },
      page.skip,
      page.take,
    );
    return toPagedResult(rows, total, page);
  }

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

  // devices api-design 07 (task 4.1 part), declared after `availability` so that path is not read as
  // an id.
  @Get(':id')
  @CheckPolicies((ability) => ability.can('read', 'Device'))
  @ResponseMessage('OK')
  detail(@Param('id', ParseUUIDPipe) id: string): Promise<DeviceDetail> {
    return this.devices.detail(id);
  }

  // devices api-design 09 (task 2.2, intake part): Staff record the intake check of a new unit or of
  // a unit back from maintenance (`device.operate`).
  @Post(':id/intake-checks')
  @CheckPolicies((ability) => ability.can('operate', 'Device'))
  @ResponseMessage('Intake check recorded')
  recordIntake(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: IntakeCheckDto,
    @CurrentCaller() caller: Caller,
  ) {
    return this.events.transaction((tx) => this.intake.record(id, dto, caller.id, new Date(), tx));
  }
}
