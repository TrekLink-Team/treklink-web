import { IsDefined, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

// devices api-design 05. `nodeNum` is the unsigned 32-bit radio id, or its node id `!a4b1c2d3`; the
// service normalizes both and refuses anything else (400 VALIDATION_FAILED).
export class RegisterDeviceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  assetTag!: string;

  @IsDefined()
  nodeNum!: number | string;

  @IsUUID()
  hardwareVariantId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  firmwareVersion!: string;

  @Matches(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, {
    message: 'acquiredAt must be a date in the form yyyy-mm-dd.',
  })
  acquiredAt!: string;
}
