import { EventKind, SyncOutcome } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PagedQueryDto } from '../../../common/dto/paging';

// The operations of `POST /api/gateway-sync` (D-027) built so far; api-design 05 and 06 join with task 4.1.
export const GATEWAY_SYNC_OPS = ['listEvents', 'listAudit', 'syncStatus'] as const;
export type GatewaySyncOp = (typeof GATEWAY_SYNC_OPS)[number];

// The look-back of syncStatus in minutes (api-design 07): at most one day.
export const SYNC_WINDOW_MAX_MINUTES = 1440;

const asArray = ({ value }: { value: unknown }) => (typeof value === 'string' ? [value] : value);

// api-design 03.
export class ListEventsDto extends PagedQueryDto {
  @IsIn(['listEvents'])
  op!: 'listEvents';

  @IsOptional()
  @IsUUID()
  deviceId?: string;

  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @IsOptional()
  @Transform(asArray)
  @IsEnum(EventKind, { each: true })
  kind?: EventKind[];

  @IsOptional()
  @IsUUID()
  incidentId?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';
}

// api-design 07.
export class SyncStatusDto {
  @IsIn(['syncStatus'])
  op!: 'syncStatus';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SYNC_WINDOW_MAX_MINUTES)
  windowMinutes?: number;
}

// api-design 04.
export class ListAuditDto extends PagedQueryDto {
  @IsIn(['listAudit'])
  op!: 'listAudit';

  @IsOptional()
  @Transform(asArray)
  @IsEnum(SyncOutcome, { each: true })
  outcome?: SyncOutcome[];

  @IsOptional()
  @IsUUID()
  deviceId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  uplinkKey?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}
