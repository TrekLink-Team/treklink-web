import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

// devices api-design 09. `motionOk` is required only for a variant with a motion sensor, which the
// service checks (400 MOTION_RESULT_REQUIRED).
export class IntakeCheckDto {
  @IsBoolean()
  gpsFixOk!: boolean;

  @IsBoolean()
  radioOk!: boolean;

  @IsBoolean()
  batteryOk!: boolean;

  @IsOptional()
  @IsBoolean()
  motionOk?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsInt()
  @Min(0)
  expectedVersion!: number;
}
