import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { DomainException, ErrorCode } from '../../../common/errors';
import { CHECK_POLICIES_KEY, PolicyHandler } from '../decorators/check-policies.decorator';
import { AuthUser } from '../strategies/jwt.strategy';

export const forbidden = () =>
  new DomainException(HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN, 'You do not have access to this.');

// Evaluates the handler's @CheckPolicies against the caller's ability, which JwtAuthGuard set.
// A missing permission is 403 FORBIDDEN (FR-AUTH-01, REQ-UBI-04). A handler with no
// @CheckPolicies is refused rather than let through, so a forgotten policy fails closed.
@Injectable()
export class PoliciesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const handlers = this.reflector.getAllAndOverride<PolicyHandler[] | undefined>(
      CHECK_POLICIES_KEY,
      [context.getHandler(), context.getClass()],
    );
    const user = context.switchToHttp().getRequest<Request & { user?: AuthUser }>().user;

    if (!user) {
      throw new DomainException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.UNAUTHENTICATED,
        'Authentication required.',
      );
    }
    if (!handlers?.length || !handlers.every((handler) => handler(user.ability))) {
      throw forbidden();
    }
    return true;
  }
}
