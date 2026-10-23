import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { AuthUser } from '../strategies/jwt.strategy';

// The authenticated caller set by JwtAuthGuard.
export const currentUserOf = (_data: unknown, context: ExecutionContext): AuthUser =>
  context.switchToHttp().getRequest<Request & { user: AuthUser }>().user;

export const CurrentUser = createParamDecorator(currentUserOf);
