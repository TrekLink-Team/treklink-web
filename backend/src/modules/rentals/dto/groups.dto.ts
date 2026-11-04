import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class GroupQueryDto {
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}

class GroupDetailsDto {
  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string | null;

  @IsOptional()
  @Matches(DATE_ONLY)
  @IsDateString({ strict: true })
  startsOn?: string | null;

  @IsOptional()
  @Matches(DATE_ONLY)
  @IsDateString({ strict: true })
  endsOn?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  areaNote?: string | null;
}

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateGroupDto extends GroupDetailsDto {
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  name!: string;
}

export class UpdateGroupDto extends GroupDetailsDto {
  @ValidateIf((dto: UpdateGroupDto) => dto.name !== undefined)
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  name?: string;

  @IsInt()
  @Min(1)
  expectedVersion!: number;
}
