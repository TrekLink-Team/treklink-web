import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createMongoAbility } from '@casl/ability';
import { ErrorCode } from '../../../common/errors';
import { AppAbility } from '../casl/ability.factory';
import {
  CHECK_POLICIES_KEY,
  CheckPolicies,
  PolicyHandler,
} from '../decorators/check-policies.decorator';
import { AuthUser } from '../strategies/jwt.strategy';
import { anAuthUser } from '../testing/auth-fixtures';
import { PoliciesGuard } from './policies.guard';

const contextFor = (user: AuthUser | undefined): ExecutionContext =>
  ({
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

describe('PoliciesGuard', () => {
  const reflector = { getAllAndOverride: jest.fn() };
  const guard = new PoliciesGuard(reflector as unknown as Reflector);
  const staff = anAuthUser(
    {},
    createMongoAbility<AppAbility>([{ action: 'read', subject: 'Incident' }]),
  );
  const canRead: PolicyHandler = (ability) => ability.can('read', 'Incident');
  const canDecide: PolicyHandler = (ability) => ability.can('decide', 'Organization');

  it('passes when every handler allows (FR-AUTH-01)', () => {
    reflector.getAllAndOverride.mockReturnValue([canRead]);

    expect(guard.canActivate(contextFor(staff))).toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(CHECK_POLICIES_KEY, [
      expect.any(Function),
      expect.any(Function),
    ]);
  });

  it.each([
    ['a handler refuses', [canRead, canDecide]],
    ['the route declares no policy, so a forgotten policy fails closed', undefined],
    ['the route declares an empty policy list', []],
  ])('answers 403 FORBIDDEN when %s (REQ-UBI-04)', (_label, handlers) => {
    reflector.getAllAndOverride.mockReturnValue(handlers);

    expect(() => guard.canActivate(contextFor(staff))).toThrow(
      expect.objectContaining({
        errorCode: ErrorCode.FORBIDDEN,
        message: 'You do not have access to this.',
      }) as Error,
    );
  });

  it('answers 401 when no guard authenticated the caller', () => {
    reflector.getAllAndOverride.mockReturnValue([canRead]);

    expect(() => guard.canActivate(contextFor(undefined))).toThrow(
      expect.objectContaining({ errorCode: ErrorCode.UNAUTHENTICATED }) as Error,
    );
  });
});

describe('@CheckPolicies', () => {
  it('stores the handlers for the guard', () => {
    const handler: PolicyHandler = () => true;
    class Probe {
      @CheckPolicies(handler)
      route() {}
    }
    const { route } = Object.getOwnPropertyDescriptors(Probe.prototype);

    expect(new Reflector().get(CHECK_POLICIES_KEY, route.value as () => void)).toEqual([handler]);
  });
});
