import { Controller, Get, HttpStatus, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { CheckPolicies } from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { AuthOneOf, CurrentPrincipal, type RequestPrincipal } from '../auth';
import { ApiRateLimiter } from './api-rate-limiter';
import {
  API_KEY_SCHEME,
  ApiEnvelopeError,
  CURSOR_EXPIRED_MESSAGE,
  DEVICES_OK,
  FORBIDDEN_MESSAGE,
  ORG_API_TAG,
  RATE_LIMITED_MESSAGE,
  STREAM_OK,
  UNAUTHENTICATED_MESSAGE,
} from './org-api.openapi';
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
@ApiTags(ORG_API_TAG)
@ApiSecurity(API_KEY_SCHEME)
@Controller('telemetry')
export class OrgApiController {
  constructor(
    private readonly orgApi: OrgApiService,
    private readonly limiter: ApiRateLimiter,
  ) {}

  @ApiOperation({
    operationId: 'listTelemetryDevices',
    summary: 'List devices and their last state',
    description:
      "Every unit of the organization's open contracts, from handover until check-in or a confirmed " +
      'loss, reporting or not, with its state, last position, battery, holder label and open incident. ' +
      '`state` is LIVE (heard since the handover and within the stale limit), OFFLINE (heard since the ' +
      'handover, silent longer) or NOT_HEARD (nothing heard since the handover). `position`, ' +
      '`batteryPct` and `lastSeenAt` lie inside your custody interval or are null, so a NOT_HEARD unit ' +
      'has all three null and nothing from before the handover is sent. `cursor` is the stream position ' +
      'at the time of the read: pass it as `after` to GET /telemetry/stream.',
  })
  @ApiOkResponse({ description: 'The devices and the cursor to stream from.', schema: DEVICES_OK })
  @ApiEnvelopeError(
    401,
    'Missing, malformed, unknown or revoked API key.',
    'UNAUTHENTICATED',
    UNAUTHENTICATED_MESSAGE,
  )
  @ApiEnvelopeError(
    403,
    'An access token was sent instead of an API key.',
    'FORBIDDEN',
    FORBIDDEN_MESSAGE,
  )
  @ApiEnvelopeError(
    429,
    "More requests than the key's limit in the current minute.",
    'RATE_LIMITED',
    RATE_LIMITED_MESSAGE,
  )
  @Get('devices')
  @AuthOneOf('apiKey')
  @CheckPolicies((ability) => ability.can('read', 'LiveMap'))
  @ResponseMessage('OK')
  async devices(@CurrentPrincipal() principal: RequestPrincipal) {
    const key = keyOrganization(principal);
    await this.limiter.hit(key.apiKeyId);
    return this.orgApi.devicesOf(key.organizationId);
  }

  @ApiOperation({
    operationId: 'readTelemetryStream',
    summary: 'Read the stream after a cursor',
    description:
      "Returns the organization's stream entries after a cursor (positions, telemetry, staleness and " +
      'incident changes), oldest first, at most `limit`. Poll with the last `nextCursor`. Start from the ' +
      '`cursor` of GET /telemetry/devices. A cursor older than the retention window answers 410 and the ' +
      "client reads the devices again. No entry of a unit from before the organization's custody is " +
      'returned.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Most entries to return.',
    schema: {
      type: 'integer',
      minimum: 1,
      maximum: REPLAY_BATCH_SIZE,
      default: REPLAY_BATCH_SIZE,
      example: 200,
    },
  })
  @ApiQuery({
    name: 'after',
    required: true,
    description: 'Last cursor seen. Entries with a greater seq are returned.',
    schema: { type: 'integer', minimum: 0, example: 88213 },
  })
  @ApiOkResponse({ description: 'One page of entries, oldest first.', schema: STREAM_OK })
  @ApiEnvelopeError(
    400,
    'The query fails validation: after is missing or not a whole number, or limit is outside 1 to 500.',
    'VALIDATION_FAILED',
    'after must be an integer number',
  )
  @ApiEnvelopeError(
    401,
    'Missing, malformed, unknown or revoked API key.',
    'UNAUTHENTICATED',
    UNAUTHENTICATED_MESSAGE,
  )
  @ApiEnvelopeError(
    403,
    'An access token was sent instead of an API key.',
    'FORBIDDEN',
    FORBIDDEN_MESSAGE,
  )
  @ApiEnvelopeError(
    410,
    'The cursor is older than the stream retention window.',
    'CURSOR_EXPIRED',
    CURSOR_EXPIRED_MESSAGE,
  )
  @ApiEnvelopeError(
    429,
    "More requests than the key's limit in the current minute.",
    'RATE_LIMITED',
    RATE_LIMITED_MESSAGE,
  )
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
