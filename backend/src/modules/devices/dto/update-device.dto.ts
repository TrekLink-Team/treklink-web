import { Transform } from 'class-transformer';
import { IsInt, IsString, MaxLength, Min, MinLength } from 'class-validator';

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// devices api-design 08 (FR-DEV-01): the firmware version is the only editable device field.
// Identity fields never change and state changes have their own endpoints; any other field in the
// body is refused by the global whitelist pipe.
export class UpdateDeviceDto {
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  firmwareVersion!: string;

  @IsInt()
  @Min(0)
  expectedVersion!: number;
}
