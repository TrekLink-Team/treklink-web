import { ComplianceActionKind, ComplianceCaseStatus, ComplianceCaseType } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { PagedQueryDto } from '../../../common/dto/paging';

const TEXT = /\S/;

// organizations api-design 28.
export class ComplianceCaseQueryDto extends PagedQueryDto {
  @IsOptional()
  @IsIn(Object.values(ComplianceCaseStatus))
  status?: ComplianceCaseStatus;
}

// organizations api-design 29.
export class OpenComplianceCaseDto {
  @IsIn(Object.values(ComplianceCaseType))
  type!: ComplianceCaseType;

  @IsString()
  @Matches(TEXT, { message: 'evidence is required.' })
  @MaxLength(2000)
  evidence!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  linkedContractIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  linkedLossCaseIds?: string[];
}

// organizations api-design 30.
export class ComplianceActionDto {
  @IsIn(Object.values(ComplianceActionKind))
  kind!: ComplianceActionKind;

  @IsOptional()
  @IsUUID('all')
  targetId?: string | null;

  @IsString()
  @Matches(TEXT, { message: 'note is required.' })
  @MaxLength(500)
  note!: string;
}

// organizations api-design 31.
export class CloseComplianceCaseDto {
  @IsString()
  @Matches(TEXT, { message: 'outcome is required.' })
  @MaxLength(2000)
  outcome!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  authorityReference?: string | null;
}

// organizations api-design 27, the channel key rotation recorded from screen 3.6.
export class RotateChannelKeyDto {
  @IsString()
  @Matches(TEXT, { message: 'reason is required.' })
  @MaxLength(500)
  reason!: string;

  @IsInt()
  @Min(0)
  expectedVersion!: number;
}
