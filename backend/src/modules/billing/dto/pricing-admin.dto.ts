import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { PagedQueryDto } from '../../../common/dto/paging';

// billing api-design 03.
export class PriceHistoryQueryDto extends PagedQueryDto {
  @IsOptional()
  @IsUUID()
  hardwareVariantId?: string;
}

// billing api-design 04. A past effective time is the service's 400 EFFECTIVE_IN_PAST.
export class NewPriceDto {
  @IsUUID()
  hardwareVariantId!: string;

  @IsInt()
  @Min(1)
  monthlyPriceVnd!: number;

  @IsDateString()
  effectiveFrom!: string;
}

// billing api-design 05.
export class DamageRateQueryDto {
  @IsOptional()
  @IsUUID()
  hardwareVariantId?: string;
}

// billing api-design 06. A null variant applies to every variant.
export class NewDamageRateDto {
  @Matches(/^[A-Z][A-Z0-9_]*$/, { message: 'code must be UPPER_SNAKE_CASE.' })
  @MaxLength(40)
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  label!: string;

  @ValidateIf((dto: NewDamageRateDto) => dto.hardwareVariantId !== null)
  @IsOptional()
  @IsUUID()
  hardwareVariantId?: string | null;

  @IsInt()
  @Min(1)
  amountVnd!: number;
}

// billing api-design 07.
export class DamageRatePatchDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  label?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  amountVnd?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
