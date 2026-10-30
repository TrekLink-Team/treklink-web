import { DamageChargeStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { PagedQueryDto } from '../../../common/dto/paging';

export const DAMAGE_DECISIONS = ['APPROVED', 'REDUCED', 'WAIVED'] as const;
export type DamageDecisionKind = (typeof DAMAGE_DECISIONS)[number];

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// billing api-design 16. Admins read `status=PENDING_APPROVAL` as their approval queue (BR-24).
export class DamageChargeQueryDto extends PagedQueryDto {
  @IsOptional()
  @IsEnum(DamageChargeStatus)
  status?: DamageChargeStatus;

  @IsOptional()
  @IsUUID()
  contractId?: string;
}

// billing api-design 17. `finalVnd` is required for REDUCED; the service checks it is above zero and
// below the charged amount, which the DTO cannot see.
export class DamageDecisionDto {
  @IsIn(DAMAGE_DECISIONS)
  decision!: DamageDecisionKind;

  @ValidateIf((dto: DamageDecisionDto) => dto.decision === 'REDUCED')
  @IsInt()
  @Min(1)
  finalVnd?: number;

  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  note!: string;
}
