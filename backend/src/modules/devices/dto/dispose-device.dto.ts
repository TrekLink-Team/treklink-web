import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsString, MaxLength, Min, MinLength } from 'class-validator';

// Surrounding spaces are trimmed before validation, so a whitespace-only value fails MinLength(1).
const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// devices api-design 23 (task 2.7, FR-DEV-16, BR-42): an Admin records the verified wipe of a
// RETIRED device (channel key, node database, owner name) and moves it to DISPOSED. All three wipe
// steps must be true (400 WIPE_INCOMPLETE), the same shape as the counter reset (api-design 10).
export class DisposeDeviceDto {
  @IsBoolean()
  keyRemoved!: boolean;

  @IsBoolean()
  nodeDbCleared!: boolean;

  @IsBoolean()
  ownerCleared!: boolean;

  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  method!: string;

  @IsInt()
  @Min(0)
  expectedVersion!: number;
}
