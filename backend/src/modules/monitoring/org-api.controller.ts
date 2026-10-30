import { Controller, Get, HttpStatus, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { CheckPolicies } from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { AuthOneOf, CurrentPrincipal, type RequestPrincipal } from '../auth';
import { ApiRateLimiter } from './api-rate-limiter';
import { OrgApiService } from './org-api.service';
import { REPLAY_BATCH_SIZE } from './replay.service';

// api-design 05: `after` is required, `limit` at most 500.
export class StreamQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  after!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(REPLAY_BATCH_SIZE)
  limit?: number;
}

// The organization of the verified key. An access token is refused here: the organization API is
// for an organization's own systems, through `X-Api-Key` only (api-design 04 and 05, BR-20).
const keyOrganization = (
  principal: RequestPrincipal,
): { apiKeyId: string; organizationId: string } => {
  if (principal.kind !== 'API_KEY') {
    throw new DomainException(
      HttpStatus.FORBIDDEN,
      ErrorCode.FORBIDDEN,
      'You do not have access to this.',
    );
  }
  return { apiKeyId: principal.apiKeyId, organizationId: principal.organization.id };
};

// The organization API (task 3.2, api-design 04 and 05, UC-39): read-only, authenticated by an
// organization API key, limited to `monitoring.apiRateLimitPerMinute` per key.
@Controller('telemetry')
export class OrgApiController {
  constructor(
    private readonly orgApi: OrgApiService,
    private readonly limiter: ApiRateLimiter,
  ) {}

  @Get('devices')
  @AuthOneOf('apiKey')
  @CheckPolicies((ability) => ability.can('read', 'LiveMap'))
  @ResponseMessage('OK')
  async devices(@CurrentPrincipal() principal: RequestPrincipal) {
    const key = keyOrganization(principal);
    await this.limiter.hit(key.apiKeyId);
    return this.orgApi.devicesOf(key.organizationId);
  }

  @Get('stream')
  @AuthOneOf('apiKey')
  @CheckPolicies((ability) => ability.can('read', 'LiveMap'))
  @ResponseMessage('OK')
  async stream(@Query() query: StreamQueryDto, @CurrentPrincipal() principal: RequestPrincipal) {
    const key = keyOrganization(principal);
    await this.limiter.hit(key.apiKeyId);
    return this.orgApi.streamOf(key.organizationId, query.after, query.limit ?? REPLAY_BATCH_SIZE);
  }
}
