import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// organizations api-design 24. A blank name after trimming is "name is required." (MSG02).
export class CreateFieldStationDto {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty({ message: 'name is required.' })
  @MaxLength(100)
  name!: string;
}

// organizations api-design 25. The reason is optional for the Manager and required for TrekLink Staff
// and Admin; the service checks which one is calling.
export class RevokeFieldStationDto {
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(500)
  reason?: string;
}
