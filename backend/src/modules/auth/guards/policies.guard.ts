import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { DomainException, ErrorCode } from '../../../common/errors';
import {
  CHECK_POLICIES_KEY,
  isAuthenticatedOnly,
  isPublic,
  PolicyHandler,
} from '../../../common/decorators/access.decorator';
import { routeAcceptsApiKey } from '../decorators/auth-one-of.decorator';
import { RequestPrincipal } from './api-key.guard';

export const forbidden = () =>
  new DomainException(HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN, 'You do not have access to this.');

// Evaluates the handler's @CheckPolicies against the caller's ability, which JwtAuthGuard set. Global
// since D-061, after JwtAuthGuard. @Public skips it; @Authenticated needs only the token. A missing
// permission is 403 FORBIDDEN (FR-AUTH-01, REQ-UBI-04). A handler with none of the three is refused
// rather than let through, so a forgotten policy fails closed. An API key caller is refused with 403
// on every route except a read route marked `@AuthOneOf(..., 'apiKey')`, so a key never satisfies a
// mutating endpoint (REQ-UBI-04, BR-20).
@Injectable()
export class PoliciesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (isPublic(this.reflector, context)) return true;
    const handlers = this.reflector.getAllAndOverride<PolicyHandler[] | undefined>(
      CHECK_POLICIES_KEY,
      [context.getHandler(), context.getClass()],
    );
    const user = context.switchToHttp().getRequest<Request & { user?: RequestPrincipal }>().user;

    if (!user) {
      throw new DomainException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.UNAUTHENTICATED,
        'Authentication required.',
      );
    }
    if (user.kind === 'API_KEY' && !routeAcceptsApiKey(this.reflector, context)) throw forbidden();
    if (isAuthenticatedOnly(this.reflector, context)) return true;
    if (!handlers?.length || !handlers.every((handler) => handler(user.ability))) {
      throw forbidden();
    }
    return true;
  }
}
