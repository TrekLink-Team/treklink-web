import { IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PagedQueryDto } from '../../../common/dto/paging';

// GET /api/audit-logs (api-design 05). `from` is inclusive, `to` exclusive; `action` is a prefix.
export class AuditLogQueryDto extends PagedQueryDto {
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  subjectType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  subjectId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}
