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
  Put,
  Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeviceStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Caller, CheckPolicies, CurrentCaller } from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import {
  PagedResult,
  PagedQueryDto,
  pagingBoundsFrom,
  resolvePage,
  toPagedResult,
} from '../../common/dto/paging';
import { resolveSort, SORT_ORDERS, SortOrder } from '../../common/dto/sorting';
import { AUDIT_RECORD, AuditRecordEvent } from '../platform/audit/audit-record.event';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { DeviceView } from './device-view';
import { DEVICE_SORT_FIELDS, DeviceSortField } from './devices.repository';
import { DeviceDetail, DevicesService, FleetDevice } from './devices.service';
import { DisposeDeviceDto } from './dto/dispose-device.dto';
import { IntakeCheckDto } from './dto/intake-check.dto';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { RetireDeviceDto } from './dto/retire-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';
import { IntakeService } from './intake.service';
import { DeviceConnectorService, RecognizedUnit } from './dock/device-connector.service';
import { DockSessionService, DockSessionView } from './dock/dock-session.service';
import { fromNodeId, isNodeNum } from './node-id';
import { DomainException, ErrorCode } from '../../common/errors';

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

  // W26: one column of the allowlist; an unknown field answers 400 VALIDATION_FAILED.
  @IsOptional()
  @IsIn(DEVICE_SORT_FIELDS)
  sort?: DeviceSortField;

  @IsOptional()
  @IsIn(SORT_ORDERS)
  order?: SortOrder;
}

// devices api-design 30: one to twenty node numbers, each a decimal number or a node id `!a4b1c2d3`;
// `nodeNum` repeats (`?nodeNum=1&nodeNum=2`).
export class ByNodeQueryDto {
  @Transform(({ value }: { value: unknown }): unknown[] =>
    Array.isArray(value) ? (value as unknown[]) : [value],
  )
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @Matches(/^(\d{1,10}|![0-9a-fA-F]{8})$/, { each: true })
  nodeNum!: string[];
}

// devices api-design 31: the node number the browser read from the unit it holds.
export class DockDto {
  @IsInt()
  @Min(0)
  @Max(0xffffffff)
  nodeNum!: number;
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

  // The docked unit's node number, sent by the device hub's factory reset (design §12.13); it must be
  // the device's (409 NODE_MISMATCH). Absent on the counter's manual reset.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(0xffffffff)
  nodeNum?: number;
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
    private readonly connector: DeviceConnectorService,
    private readonly dockSessions: DockSessionService,
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
      resolveSort(query),
    );
    return toPagedResult(rows, total, page);
  }

  // devices api-design 05 (task 2.2, registration part): Staff register a unit with its asset tag and
  // node number (`device.register`); it starts IN_INTAKE.
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @CheckPolicies((ability) => ability.can('create', 'Device'))
  @ResponseMessage('Device registered')
  register(@Body() dto: RegisterDeviceDto, @CurrentCaller() caller: Caller): Promise<DeviceView> {
    return this.events.transaction((tx) => this.intake.register(dto, caller.id, new Date(), tx));
  }

  // The audit record `device.reset` goes out after commit for every reset, with the method DOCKED when
  // the device hub sent the docked node number and MANUAL otherwise (design §12.13).
  @Post(':id/reset')
  @CheckPolicies((ability) => ability.can('operate', 'Device'))
  @ResponseMessage('Reset recorded')
  reset(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetDto,
    @CurrentCaller() caller: Caller,
  ) {
    return this.events.transaction(async (tx) => {
      const { device, before } = await this.devices.reset(id, dto, caller.id, new Date(), tx);
      const docked = dto.nodeNum !== undefined;
      this.events.emitAfterCommit(AUDIT_RECORD, {
        actorId: caller.id,
        actorRoles: caller.roles,
        organizationId: null,
        action: 'device.reset',
        subjectType: 'Device',
        subjectId: id,
        before,
        after: {
          keyVersion: device.keyVersion,
          keyOrganizationId: device.keyOrganizationId,
          method: docked ? 'DOCKED' : 'MANUAL',
          nodeNum: docked ? dto.nodeNum : null,
        },
      } satisfies AuditRecordEvent);
      return device;
    });
  }

  @Get('availability')
  @CheckPolicies((ability) => ability.can('readAvailability', 'Device'))
  @ResponseMessage('OK')
  availability(@Query() query: AvailabilityQueryDto) {
    return this.devices.availability(query.hardwareVariantId);
  }

  // devices api-design 30 (task 10.2, design section 12.5): the device connector recognizes the units
  // plugged into a Staff computer by node number (`device.read`). Declared before `:id`.
  @Get('by-node')
  @CheckPolicies((ability) => ability.can('read', 'Device'))
  @ResponseMessage('OK')
  byNode(@Query() query: ByNodeQueryDto): Promise<RecognizedUnit[]> {
    const nodeNums = query.nodeNum.map((value) =>
      value.startsWith('!') ? fromNodeId(value) : BigInt(value),
    );
    if (nodeNums.some((nodeNum) => !isNodeNum(nodeNum))) {
      throw new DomainException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'nodeNum must be an unsigned 32-bit node number.',
      );
    }
    return this.connector.recognize(nodeNums);
  }

  // devices api-design 07 (task 4.1 part), declared after `availability` and `by-node` so that path is not read as
  // an id.
  @Get(':id')
  @CheckPolicies((ability) => ability.can('read', 'Device'))
  @ResponseMessage('OK')
  detail(@Param('id', ParseUUIDPipe) id: string): Promise<DeviceDetail> {
    return this.devices.detail(id);
  }

  // devices api-design 31 (task 10.3, design section 12.8): the device connector opens or renews the
  // dock session of a unit it holds at the counter (`device.operate`).
  @Put(':id/dock')
  @CheckPolicies((ability) => ability.can('operate', 'Device'))
  @ResponseMessage('Docked')
  dock(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DockDto,
    @CurrentCaller() caller: Caller,
  ): Promise<DockSessionView> {
    return this.dockSessions.dock(id, BigInt(dto.nodeNum), caller);
  }

  // devices api-design 32: ends the dock session when the connector releases the unit; success with a
  // null result when none is open.
  @Delete(':id/dock')
  @CheckPolicies((ability) => ability.can('operate', 'Device'))
  @ResponseMessage('Undocked')
  undock(@Param('id', ParseUUIDPipe) id: string): Promise<null> {
    return this.dockSessions.undock(id);
  }

  // devices api-design 08 (FR-DEV-01): Staff correct the firmware version after a reflash
  // (`device.operate`, the permission of every other Staff write on a unit). Compare-and-set on
  // `expectedVersion`; the audit record `device.update` goes out after commit.
  @Patch(':id')
  @CheckPolicies((ability) => ability.can('operate', 'Device'))
  @ResponseMessage('Saved.')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDeviceDto,
    @CurrentCaller() caller: Caller,
  ): Promise<FleetDevice> {
    return this.events.transaction(async (tx) => {
      const { before, device } = await this.devices.updateFirmware(id, dto, tx);
      this.events.emitAfterCommit(AUDIT_RECORD, {
        actorId: caller.id,
        actorRoles: caller.roles,
        organizationId: null,
        action: 'device.update',
        subjectType: 'Device',
        subjectId: id,
        before: { firmwareVersion: before },
        after: { firmwareVersion: device.firmwareVersion },
      } satisfies AuditRecordEvent);
      return device;
    });
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

  // devices api-design 16 (task 2.4): an Admin retires a MAINTENANCE device (`device.retire`).
  @Post(':id/retire')
  @HttpCode(HttpStatus.OK)
  @CheckPolicies((ability) => ability.can('retire', 'Device'))
  @ResponseMessage('Device retired')
  retire(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RetireDeviceDto,
    @CurrentCaller() caller: Caller,
  ): Promise<FleetDevice> {
    return this.events.transaction((tx) => this.devices.retire(id, dto, caller.id, new Date(), tx));
  }

  // devices api-design 23 (task 2.7): an Admin records the verified wipe of a RETIRED device and
  // moves it to DISPOSED (`device.dispose`).
  @Post(':id/dispose')
  @HttpCode(HttpStatus.CREATED)
  @CheckPolicies((ability) => ability.can('dispose', 'Device'))
  @ResponseMessage('Device disposed')
  dispose(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DisposeDeviceDto,
    @CurrentCaller() caller: Caller,
  ): Promise<FleetDevice> {
    return this.events.transaction((tx) =>
      this.devices.dispose(id, dto, caller.id, new Date(), tx),
    );
  }
}
