import { IsOptional, IsString, Matches } from 'class-validator';
import { PagedQueryDto } from '../../../common/dto/paging';

// GET /api/parameters (api-design 02).
export class ParameterListQueryDto extends PagedQueryDto {
  @IsOptional()
  @IsString()
  @Matches(/^[a-z][a-z-]*$/, { message: 'ownerModule must be a module name such as incidents' })
  ownerModule?: string;
}
