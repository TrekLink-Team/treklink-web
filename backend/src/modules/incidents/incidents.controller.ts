import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { IncidentState } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import {
  Caller,
  CheckPolicies,
  CurrentAbility,
  CurrentCaller,
  type PolicyAbility,
} from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { PagedQueryDto, PagedResult } from '../../common/dto/paging';
import {
  AlertDeliveryView,
  IncidentDetailView,
  IncidentsQueryService,
  IncidentView,
  TransitionView,
} from './incidents-query.service';
import { AuthorityReportsService } from './authority-reports.service';
import { IncidentsService, StatusUpdateResult } from './incidents.service';

const NOTE_MAX = 2000;
const TEXT_MAX = 200;

export class IncidentListQueryDto extends PagedQueryDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.split(',') : value,
  )
  @IsEnum(IncidentState, { each: true })
  state?: IncidentState[];

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  open?: boolean;

  @IsOptional()
  @IsUUID()
  deviceId?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;
}

class VersionDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedVersion!: number;
}

export class AcknowledgeDto extends VersionDto {
  @IsOptional()
  @IsString()
  @MaxLength(NOTE_MAX)
  note?: string;
}

export class RespondingDto extends VersionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(NOTE_MAX)
  note!: string;
}

export class StatusUpdateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(NOTE_MAX)
  note!: string;

  // The earlier update this one corrects (dry run defect 15).
  @IsOptional()
  @IsUUID()
  correctsId?: string;
}

export class ResolveDto extends VersionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(NOTE_MAX)
  outcomeNote!: string;
}

export class FalseAlarmDto extends VersionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(NOTE_MAX)
  reason!: string;
}

export class AuthorityReportDto extends VersionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(TEXT_MAX)
  agency!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(TEXT_MAX)
  reference!: string;

  @Type(() => Date)
  @IsDate()
  reportedAt!: Date;

  @IsOptional()
  @IsString()
  @MaxLength(NOTE_MAX)
  note?: string;
}

// Task 6.1, api-design 01 to 08, 12 and 14. Reads need `read Incident` (`incident.read` for Staff,
// `incident.read.own` for members); the alert log needs `read AlertDelivery` (Staff, or an Org
// Manager's own); member actions need `respond Incident` (`incident.respond.own`); the authority
// report needs `manage AuthorityReport` (Staff and Admin). The services check the organization and
// answer 404 for another one's incident.
@Controller('incidents')
export class IncidentsController {
  constructor(
    private readonly incidents: IncidentsService,
    private readonly queries: IncidentsQueryService,
    private readonly authority: AuthorityReportsService,
  ) {}

  @Get()
  @CheckPolicies((ability) => ability.can('read', 'Incident'))
  @ResponseMessage('OK')
  list(
    @Query() query: IncidentListQueryDto,
    @CurrentCaller() caller: Caller,
    @CurrentAbility() ability: PolicyAbility,
  ): Promise<PagedResult<IncidentView>> {
    return this.queries.list(query, caller, ability);
  }

  @Get(':id')
  @CheckPolicies((ability) => ability.can('read', 'Incident'))
  @ResponseMessage('OK')
  detail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentCaller() caller: Caller,
    @CurrentAbility() ability: PolicyAbility,
  ): Promise<IncidentDetailView> {
    return this.queries.detail(id, caller, ability);
  }

  @Get(':id/transitions')
  @CheckPolicies((ability) => ability.can('read', 'Incident'))
  @ResponseMessage('OK')
  transitions(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentCaller() caller: Caller,
    @CurrentAbility() ability: PolicyAbility,
  ): Promise<TransitionView[]> {
    return this.queries.transitions(id, caller, ability);
  }

  @Get(':id/alerts')
  @CheckPolicies((ability) => ability.can('read', 'AlertDelivery'))
  @ResponseMessage('OK')
  alerts(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentCaller() caller: Caller,
    @CurrentAbility() ability: PolicyAbility,
  ): Promise<AlertDeliveryView[]> {
    return this.queries.alerts(id, caller, ability);
  }

  @Post(':id/acknowledge')
  @HttpCode(HttpStatus.OK)
  @CheckPolicies((ability) => ability.can('respond', 'Incident'))
  @ResponseMessage('Incident acknowledged')
  async acknowledge(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AcknowledgeDto,
    @CurrentCaller() caller: Caller,
  ): Promise<IncidentView> {
    return this.view(await this.incidents.acknowledge(id, body, caller));
  }

  @Post(':id/responding')
  @HttpCode(HttpStatus.OK)
  @CheckPolicies((ability) => ability.can('respond', 'Incident'))
  @ResponseMessage('Status recorded')
  async responding(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RespondingDto,
    @CurrentCaller() caller: Caller,
  ): Promise<IncidentView> {
    return this.view(await this.incidents.responding(id, body, caller));
  }

  @Post(':id/status-updates')
  @CheckPolicies((ability) => ability.can('respond', 'Incident'))
  @ResponseMessage('Status recorded')
  statusUpdate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: StatusUpdateDto,
    @CurrentCaller() caller: Caller,
  ): Promise<StatusUpdateResult> {
    return this.incidents.addStatus(id, body, caller);
  }

  @Post(':id/resolve')
  @HttpCode(HttpStatus.OK)
  @CheckPolicies((ability) => ability.can('respond', 'Incident'))
  @ResponseMessage('Incident resolved')
  async resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ResolveDto,
    @CurrentCaller() caller: Caller,
  ): Promise<IncidentView> {
    return this.view(await this.incidents.resolve(id, body, caller));
  }

  @Post(':id/false-alarm')
  @HttpCode(HttpStatus.OK)
  @CheckPolicies(
    (ability) => ability.can('respond', 'Incident') || ability.can('respondUnrouted', 'Incident'),
  )
  @ResponseMessage('Marked as false alarm')
  async falseAlarm(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: FalseAlarmDto,
    @CurrentCaller() caller: Caller,
  ): Promise<IncidentView> {
    return this.view(await this.incidents.falseAlarm(id, body, caller));
  }

  @Post(':id/authority-reports')
  @CheckPolicies((ability) => ability.can('manage', 'AuthorityReport'))
  @ResponseMessage('Report recorded')
  async reportToAuthority(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AuthorityReportDto,
    @CurrentCaller() caller: Caller,
  ): Promise<IncidentView> {
    return this.view(await this.authority.reportIncident(id, body, caller));
  }

  private async view(incident: Parameters<IncidentsQueryService['views']>[0][number]) {
    const [view] = await this.queries.views([incident]);
    return view;
  }
}
