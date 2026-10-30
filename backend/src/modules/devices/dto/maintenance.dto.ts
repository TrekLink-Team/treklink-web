import { MaintenanceStatus, MaintenanceWorkBy } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PagedQueryDto } from '../../../common/dto/paging';
import { MAINTENANCE_REASONS } from '../maintenance.repository';

const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const dayMessage = (field: string) => ({
  message: `${field} must be a date in the form yyyy-mm-dd.`,
});
const repeatable = ({ value }: { value: unknown }): unknown[] =>
  Array.isArray(value) ? (value as unknown[]) : [value];

// devices api-design 11. Staff open STAFF_REPORTED; SCHEDULED and FIRMWARE_UPDATE are accepted for a
// service Staff start ahead of the weekly scan.
export class OpenMaintenanceDto {
  @IsIn(['STAFF_REPORTED', 'SCHEDULED', 'FIRMWARE_UPDATE'])
  reason!: 'STAFF_REPORTED' | 'SCHEDULED' | 'FIRMWARE_UPDATE';

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  description!: string;

  @Matches(DAY, dayMessage('expectedAt'))
  expectedAt!: string;

  @IsOptional()
  @IsIn(Object.values(MaintenanceWorkBy))
  workBy?: MaintenanceWorkBy;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  vendorName?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  estimatedCostVnd?: number;

  @IsInt()
  @Min(0)
  expectedVersion!: number;
}

// devices api-design 12.
export class EstimateMaintenanceDto {
  @IsIn(Object.values(MaintenanceWorkBy))
  workBy!: MaintenanceWorkBy;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  vendorName?: string;

  @IsInt()
  @Min(0)
  estimatedCostVnd!: number;

  @IsInt()
  @Min(0)
  expectedVersion!: number;
}

// devices api-design 13.
export class DecideMaintenanceDto {
  @IsIn(['APPROVED', 'REJECTED'])
  decision!: 'APPROVED' | 'REJECTED';

  @IsOptional()
  @IsInt()
  @Min(0)
  approvedCostVnd?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason?: string;

  @IsInt()
  @Min(0)
  expectedVersion!: number;
}

export class ChecklistResultDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  item!: string;

  @IsBoolean()
  passed!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

// devices api-design 14.
export class CompleteMaintenanceDto {
  @IsIn([MaintenanceStatus.COMPLETED, MaintenanceStatus.UNREPAIRABLE])
  status!: 'COMPLETED' | 'UNREPAIRABLE';

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  resolution!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  actualCostVnd?: number;

  @IsOptional()
  @Matches(DAY, dayMessage('warrantyUntil'))
  warrantyUntil?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChecklistResultDto)
  checklistResults?: ChecklistResultDto[];

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  firmwareVersion?: string;

  @IsInt()
  @Min(0)
  expectedVersion!: number;
}

// devices api-design 15; `status` and `reason` repeat.
export class MaintenanceQueryDto extends PagedQueryDto {
  @IsOptional()
  @Transform(repeatable)
  @IsIn(Object.values(MaintenanceStatus), { each: true })
  status?: MaintenanceStatus[];

  @IsOptional()
  @Transform(repeatable)
  @IsIn([...MAINTENANCE_REASONS], { each: true })
  reason?: string[];

  @IsOptional()
  @Matches(DAY, dayMessage('dueBefore'))
  dueBefore?: string;
}
