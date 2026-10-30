import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

// organizations api-design 21. A blank name after trimming is "name is required." (MSG02).
export class CreateApiKeyDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'name is required.' })
  @MaxLength(100)
  name!: string;
}
