import { IsInt, IsString, MaxLength, Min, MinLength } from 'class-validator';

// devices api-design 16 (task 2.4, FR-DEV-09): an Admin retires a MAINTENANCE device; refused outside
// that state (409 INVALID_STATE_TRANSITION, read as "not on a live contract row" per design §2,
// because every live-contract state is RESERVED or RENTED, never MAINTENANCE).
export class RetireDeviceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;

  @IsInt()
  @Min(0)
  expectedVersion!: number;
}
