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
import { DevicesService } from './devices.service';
import { toNodeId } from './node-id';

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
    private readonly events: TransactionalEvents,
    private readonly config: ConfigService<ValidatedEnvironment, true>,
  ) {}

  // devices api-design 06 (task 4.1 part, built by LongLP for the replacement of rentals 4.3): the
  // fleet for Staff and Admin (`device.read`). The last position is not served yet.
  @Get()
  @CheckPolicies((ability) => ability.can('read', 'Device'))
  @ResponseMessage('OK')
  async list(@Query() query: DeviceQueryDto): Promise<PagedResult<Record<string, unknown>>> {
    const page = resolvePage(
      query,
      pagingBoundsFrom({
        DEFAULT_PAGE_SIZE: this.config.get('DEFAULT_PAGE_SIZE', { infer: true }),
        MAX_PAGE_SIZE: this.config.get('MAX_PAGE_SIZE', { infer: true }),
      }),
    );
    const [rows, total] = await this.devices.page(
      {
        statuses: query.status,
        hardwareVariantId: query.hardwareVariantId,
        q: query.q?.trim() || undefined,
      },
      page.skip,
      page.take,
    );
    return toPagedResult(
      rows.map(({ nodeNum, serviceDueAt, ...row }) => ({
        ...row,
        nodeNum: Number(nodeNum),
        nodeId: toNodeId(nodeNum),
        serviceDueAt: serviceDueAt?.toISOString().slice(0, 10) ?? null,
      })),
      total,
      page,
    );
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
}
