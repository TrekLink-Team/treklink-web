import { Transform } from 'class-transformer';
import {
  Allow,
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const trimmedEach = ({ value }: { value: unknown }) =>
  Array.isArray(value)
    ? (value as unknown[]).map((item) => (typeof item === 'string' ? item.trim() : item))
    : value;

// The schedule, the image link and the spec sheet are checked by the service (variant-rules.ts), so a
// bad value answers its own code (SCHEDULE_INVALID, VARIANT_MEDIA_INVALID) and not VALIDATION_FAILED.
// `@Allow()` keeps them through the global whitelist.

// devices api-design 02 (task 2.1).
export class CreateVariantDto {
  @Transform(trimmed)
  @IsString()
  @MinLength(3)
  @MaxLength(40)
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'code must be lower case letters, digits and hyphens, for example treklink-v5.',
  })
  code!: string;

  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsBoolean()
  hasGps!: boolean;

  @IsBoolean()
  hasMotionSensor!: boolean;

  @IsBoolean()
  mqttCapable!: boolean;

  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  firmwareBaseline!: string;

  @Allow()
  remainingValueSchedule!: unknown;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  serviceIntervalDays?: number | null;

  @IsOptional()
  @Transform(trimmedEach)
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(120, { each: true })
  serviceChecklist?: string[];

  @Allow()
  imageUrl?: unknown;

  @Allow()
  specSheet?: unknown;
}

// devices api-design 03. The code is fixed after create, so it is not a field here and the whitelist
// refuses it. `null` on serviceIntervalDays removes the periodic service. Every other field may be left
// out but never sent as null: `@IsOptional()` would let null through to Prisma, which answered 500
// (review of treklink-web#382), so these validate whenever the key is present.
const present =
  (key: keyof UpdateVariantDto) =>
  (dto: UpdateVariantDto): boolean =>
    dto[key] !== undefined;

export class UpdateVariantDto {
  @ValidateIf(present('name'))
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @ValidateIf(present('hasGps'))
  @IsBoolean()
  hasGps?: boolean;

  @ValidateIf(present('hasMotionSensor'))
  @IsBoolean()
  hasMotionSensor?: boolean;

  @ValidateIf(present('mqttCapable'))
  @IsBoolean()
  mqttCapable?: boolean;

  @ValidateIf(present('firmwareBaseline'))
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  firmwareBaseline?: string;

  @Allow()
  remainingValueSchedule?: unknown;

  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsInt()
  @Min(1)
  @Max(3650)
  serviceIntervalDays?: number | null;

  @ValidateIf(present('serviceChecklist'))
  @Transform(trimmedEach)
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(120, { each: true })
  serviceChecklist?: string[];

  @ValidateIf(present('isActive'))
  @IsBoolean()
  isActive?: boolean;

  @Allow()
  imageUrl?: unknown;

  @Allow()
  specSheet?: unknown;

  @IsInt()
  @Min(0)
  expectedVersion!: number;
}
