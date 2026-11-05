import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PagedQueryDto } from '../../../common/dto/paging';

// devices api-design 25 (task 2.6). Tags are trimmed and upper-cased here; the service drops
// duplicates. The size bound only guards the request, a shelf count is far smaller.
export class RunStockTakeDto {
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value)
      ? (value as unknown[]).map((tag) =>
          typeof tag === 'string' ? tag.trim().toUpperCase() : tag,
        )
      : value,
  )
  @IsArray()
  @ArrayMinSize(1, { message: 'Scan at least one asset tag.' })
  @ArrayMaxSize(5000)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(64, { each: true })
  scannedTags!: string[];
}

// devices api-design 26.
export class StockTakeQueryDto extends PagedQueryDto {}
