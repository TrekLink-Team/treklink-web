import { IsDefined, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

// PATCH /api/parameters/:key (api-design 03). The value's type and bounds are checked against the
// registry by ParameterService (400 PARAMETER_OUT_OF_RANGE).
export class ParameterUpdateDto {
  @IsDefined()
  value!: unknown;

  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
