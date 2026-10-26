import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { AuthUser } from '../strategies/jwt.strategy';

import { RequestPrincipal } from '../guards/api-key.guard';

// The authenticated account set by JwtAuthGuard, on routes an API key cannot reach.
export const currentUserOf = (_data: unknown, context: ExecutionContext): AuthUser =>
  context.switchToHttp().getRequest<Request & { user: AuthUser }>().user;

export const CurrentUser = createParamDecorator(currentUserOf);

// The account or the organization API key, on routes marked `@AuthOneOf('jwt', 'apiKey')`; pass it
// to `scopeWhere` (auth task 4.3).
export const currentPrincipalOf = (_data: unknown, context: ExecutionContext): RequestPrincipal =>
  context.switchToHttp().getRequest<Request & { user: RequestPrincipal }>().user;

export const CurrentPrincipal = createParamDecorator(currentPrincipalOf);
