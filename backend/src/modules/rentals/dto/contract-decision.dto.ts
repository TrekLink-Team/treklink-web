import { ContractStatus, PlanType } from '@prisma/client';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { PagedQueryDto } from '../../../common/dto/paging';

// rentals api-design 02.
export class ContractQueryDto extends PagedQueryDto {
  @IsOptional()
  @IsIn(Object.values(ContractStatus))
  status?: ContractStatus;

  @IsOptional()
  @IsIn(Object.values(PlanType))
  planType?: PlanType;
}

// rentals api-design 04. The explicit `deviceIds` choice is not offered yet: the server picks the
// units, the longest unchanged first (screen 5.3).
export class ApproveContractDto {
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
