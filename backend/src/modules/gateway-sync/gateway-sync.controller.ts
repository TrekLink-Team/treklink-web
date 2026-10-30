import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Type as ClassType,
  ValidationPipe,
} from '@nestjs/common';
import {
  CheckPolicies,
  CurrentAbility,
  type PolicyAbility,
} from '../../common/decorators/access.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { PagedResult } from '../../common/dto/paging';
import { DomainException, ErrorCode } from '../../common/errors';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import {
  GATEWAY_SYNC_OPS,
  GatewaySyncOp,
  ListEventsDto,
  SyncStatusDto,
} from './dto/gateway-sync-ops.dto';
import { FieldEventQueryService, FieldEventView } from './field-event-query.service';
import { SyncStatusService, SyncStatusView } from './sync-status.service';

// The same options as the global pipe (app.setup.ts); the body is validated per operation, because the
// global pipe cannot pick a DTO from the `op` value.
const opPipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});

const isOp = (value: unknown): value is GatewaySyncOp =>
  typeof value === 'string' && (GATEWAY_SYNC_OPS as readonly string[]).includes(value);

const forbidden = () =>
  new DomainException(HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN, 'You do not have access to this.');

// `POST /api/gateway-sync`, the D-027 operation endpoint (task 4.1). Both operations built so far are
// reads for TrekLink Staff and Admin: `listEvents` needs `read FieldEvent` (`fieldEvent.read`, api-design
// 03); `syncStatus` needs that and `read FieldStation` (`fieldStation.read`, api-design 07). An
// organization role holds neither, and an API key is refused by the route policy.
@Controller('gateway-sync')
export class GatewaySyncController {
  constructor(
    private readonly events: FieldEventQueryService,
    private readonly status: SyncStatusService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @CheckPolicies((ability) => ability.can('read', 'FieldEvent'))
  @ResponseMessage('OK')
  async dispatch(
    @Body() body: unknown,
    @CurrentAbility() ability: PolicyAbility,
  ): Promise<PagedResult<FieldEventView> | SyncStatusView> {
    const op =
      typeof body === 'object' && body !== null ? (body as { op?: unknown }).op : undefined;
    if (!isOp(op)) {
      throw new DomainException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        `op must be one of the following values: ${GATEWAY_SYNC_OPS.join(', ')}`,
      );
    }
    if (op === 'listEvents') {
      return this.events.listEvents(await this.parse(ListEventsDto, body));
    }
    if (!ability.can('read', 'FieldStation')) throw forbidden();
    return this.status.status(await this.parse(SyncStatusDto, body));
  }

  private parse<T>(metatype: ClassType<T>, body: unknown): Promise<T> {
    return opPipe.transform(body, { type: 'body', metatype }) as Promise<T>;
  }
}
