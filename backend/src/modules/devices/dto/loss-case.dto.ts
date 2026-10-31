import { LossCaseState, LossDecision } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PagedQueryDto } from '../../../common/dto/paging';

// Surrounding spaces are trimmed before validation, so a whitespace-only value fails MinLength(1).
const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// A blank optional text is no text.
const trimmedOrNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

// devices api-design 17 (UC-49): where and when it was last seen (ui-design 4-4: 1 to 1000).
export class ReportLossDto {
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  description!: string;
}

// devices api-design 19 (UC-60).
export class TriageLossDto {
  @IsBoolean()
  suspectedTheft!: boolean;

  @IsOptional()
  @Transform(trimmedOrNull)
  @IsString()
  @MaxLength(60)
  policeReference?: string | null;

  @IsInt()
  @Min(0)
  expectedVersion!: number;
}

// devices api-design 20 (FR-DEV-14).
export class RecoverLossDto {
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  note!: string;

  @IsInt()
  @Min(0)
  expectedVersion!: number;
}

// devices api-design 21 (FR-DEV-15).
export class ConfirmLossDto {
  @IsInt()
  @Min(0)
  expectedVersion!: number;
}

// devices api-design 22 (FR-BILL-11, BR-39). The pairing of decision, charge and reason is checked
// by LossCaseService against the case's custody and confirmed charge.
export class DecideLossDto {
  @IsEnum(LossDecision)
  decision!: LossDecision;

  @IsOptional()
  @IsInt()
  @Min(0)
  chargeVnd?: number | null;

  @IsOptional()
  @Transform(trimmedOrNull)
  @IsString()
  @MaxLength(500)
  reason?: string | null;

  @IsInt()
  @Min(0)
  expectedVersion!: number;
}

// devices api-design 18.
export class LossCaseQueryDto extends PagedQueryDto {
  @IsOptional()
  @IsEnum(LossCaseState)
  state?: LossCaseState;
}
