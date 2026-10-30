import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, MaxLength, Min } from 'class-validator';

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// organizations api-design 08 and 10. The reason is shown to the Manager and kept on the transition.
export class OrganizationReasonDto {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty({ message: 'reason is required.' })
  @MaxLength(500)
  reason!: string;

  @IsInt()
  @Min(0)
  expectedVersion!: number;
}

// organizations api-design 09.
export class ExpectedVersionDto {
  @IsInt()
  @Min(0)
  expectedVersion!: number;
}
