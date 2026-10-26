import { createParamDecorator, ExecutionContext, HttpStatus, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainException, ErrorCode } from '../errors';

// Route access metadata (D-061). `auth` registers JwtAuthGuard and PoliciesGuard globally; these
// decorators live in `common` so a module below `auth` in platform design Figure 3 can declare them.
// A route with none of @Public, @Authenticated or @CheckPolicies is refused, so a forgotten policy
// fails closed.

export const IS_PUBLIC_KEY = 'treklink:public';
export const AUTHENTICATED_ONLY_KEY = 'treklink:authenticatedOnly';
export const CHECK_POLICIES_KEY = 'treklink:checkPolicies';

// The part of the CASL ability a policy handler uses; `auth`'s AppAbility satisfies it.
export interface PolicyAbility {
  can(action: string, subject: string | object, field?: string): boolean;
}

export type PolicyHandler = (ability: PolicyAbility) => boolean;

// No token and no permission: sign-in, refresh, health, the SePay webhook, the broker hooks.
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

// A valid token and no permission: sign-out and the caller's own account.
export const Authenticated = () => SetMetadata(AUTHENTICATED_ONLY_KEY, true);

// The type-level permission a handler needs, e.g.
// `@CheckPolicies((ability) => ability.can('manage', 'Parameter'))`. Every handler must pass.
// Record-level `own` checks use auth's `assertOwnOr404` after loading the row.
export const CheckPolicies = (...handlers: PolicyHandler[]) =>
  SetMetadata(CHECK_POLICIES_KEY, handlers);

const flag = (reflector: Reflector, key: string, context: ExecutionContext): boolean =>
  reflector.getAllAndOverride<boolean | undefined>(key, [
    context.getHandler(),
    context.getClass(),
  ]) === true;

export const isPublic = (reflector: Reflector, context: ExecutionContext) =>
  flag(reflector, IS_PUBLIC_KEY, context);

export const isAuthenticatedOnly = (reflector: Reflector, context: ExecutionContext) =>
  flag(reflector, AUTHENTICATED_ONLY_KEY, context);

// The verified caller as a module below `auth` needs it: id, roles and organization, all from the
// token-verified request context (auth REQ-UBI-06), never from the request body or path.
export interface Caller {
  id: string;
  roles: string[];
  organizationId: string | null;
}

interface RequestUser {
  kind?: string;
  id: string;
  roles: string[];
  organization?: { id: string } | null;
}

// An organization API key acts as no account, so it has no Caller: a handler that needs one is a
// handler a key must not reach, and the key is refused with 403 (auth task 4.3, BR-20).
export const callerOf = (_data: unknown, context: ExecutionContext): Caller => {
  const user = context.switchToHttp().getRequest<{ user: RequestUser }>().user;
  if (user.kind === 'API_KEY') {
    throw new DomainException(
      HttpStatus.FORBIDDEN,
      ErrorCode.FORBIDDEN,
      'You do not have access to this.',
    );
  }
  return { id: user.id, roles: user.roles, organizationId: user.organization?.id ?? null };
};

export const CurrentCaller = createParamDecorator(callerOf);
