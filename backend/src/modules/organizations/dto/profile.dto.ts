import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { PHONE } from './onboarding.dto';

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// organizations api-design 04. Every field is optional; the service refuses a body that names none.
// `legalName` is for TrekLink Admin only, because the master contract names it.
export class UpdateOrganizationDto {
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  address?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsEmail()
  @MaxLength(254)
  contactEmail?: string;

  @IsOptional()
  @Matches(PHONE, { message: 'contactPhone must be a phone number' })
  contactPhone?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  legalName?: string;

  @IsInt()
  @Min(0)
  expectedVersion!: number;
}
