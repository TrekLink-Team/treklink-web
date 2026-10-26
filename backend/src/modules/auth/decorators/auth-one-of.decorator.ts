import { ExecutionContext, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

// The credentials a route accepts (specs/auth/design.md §2). Without it a route accepts only an
// access token. `@AuthOneOf('jwt', 'apiKey')` also lets an organization API key read it; the
// organization API controllers use it (auth task 4.3).
export type AuthKind = 'jwt' | 'apiKey';

export const AUTH_ONE_OF_KEY = 'treklink:authOneOf';

export const AuthOneOf = (...kinds: AuthKind[]) => SetMetadata(AUTH_ONE_OF_KEY, kinds);

const READ_METHODS = new Set(['GET', 'HEAD']);

// An API key is accepted only on a read route marked for it: never on a mutating route, whatever its
// marking (REQ-UBI-04, BR-20).
export const routeAcceptsApiKey = (reflector: Reflector, context: ExecutionContext): boolean => {
  const kinds = reflector.getAllAndOverride<AuthKind[] | undefined>(AUTH_ONE_OF_KEY, [
    context.getHandler(),
    context.getClass(),
  ]);
  const method = context.switchToHttp().getRequest<{ method?: string }>().method ?? '';
  return (kinds?.includes('apiKey') ?? false) && READ_METHODS.has(method.toUpperCase());
};
