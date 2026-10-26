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
