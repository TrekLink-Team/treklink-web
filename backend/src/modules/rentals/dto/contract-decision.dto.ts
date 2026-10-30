import { ContractStatus, PlanType } from '@prisma/client';
import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsArray,
  ArrayUnique,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PagedQueryDto } from '../../../common/dto/paging';

// rentals api-design 02.
export class ContractQueryDto extends PagedQueryDto {
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @IsOptional()
  @IsIn(Object.values(ContractStatus))
  status?: ContractStatus;

  @IsOptional()
  @IsIn(Object.values(PlanType))
  planType?: PlanType;
}

// rentals api-design 04. Without an explicit choice, the server picks the longest-unchanged units.
export class ApproveContractDto {
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  deviceIds?: string[];

  @IsDateString()
  handoverAt!: string;

  @IsInt()
  @Min(0)
  expectedVersion!: number;
}

// rentals api-design 05 and 06.
export class ContractReasonDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;

  @IsInt()
  @Min(0)
  expectedVersion!: number;
}

// rentals api-design 07.
export class SwapDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  reason!: string;
}

// rentals api-design 09.
export class ProvisioningDto {
  @IsInt()
  @Min(1)
  keyVersion!: number;
}

export class DeviceCheckDto {
  @IsUUID()
  deviceId!: string;

  @IsInt()
  @Min(0)
  @Max(100)
  batteryPct!: number;

  @IsBoolean()
  gpsFixOk!: boolean;
}

// rentals api-design 08. `checks` is the JSON array of the readings the counter holds, in the shape
// of api-design 10 `deviceChecks`, so the preview prints them; a unit without a reading prints
// "not checked". A value that is not JSON fails the array check (400 VALIDATION_FAILED).
const parseChecks = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? plainToInstance(DeviceCheckDto, parsed) : parsed;
  } catch {
    return value;
  }
};

export class HandoverPreviewQueryDto {
  @IsOptional()
  @Transform(parseChecks)
  @IsArray()
  @ValidateNested({ each: true })
  checks?: DeviceCheckDto[];
}

// rentals api-design 10. `signedByMemberId` is the signing Manager's account id, as in
// organizations api-design 12 `userId`.
export class HandoverDto {
  @IsUUID()
  signedByMemberId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  identityChecked!: string;

  @IsString()
  @IsNotEmpty()
  signaturePng!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeviceCheckDto)
  deviceChecks!: DeviceCheckDto[];

  @IsOptional()
  @IsBoolean()
  acknowledgeLowBattery?: boolean;

  @IsInt()
  @Min(0)
  expectedVersion!: number;
}

// rentals api-design 12.
export class NoticeDto {
  @IsInt()
  @Min(0)
  expectedVersion!: number;
}

// rentals api-design 13. A null or empty name clears the label; the other fields are optional.
export class HolderDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  emergencyContact?: string | null;
}
