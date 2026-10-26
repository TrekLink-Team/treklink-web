import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createMongoAbility } from '@casl/ability';
import { AUTHENTICATED_ONLY_KEY, IS_PUBLIC_KEY } from '../../../common/decorators/access.decorator';
import { ErrorCode } from '../../../common/errors';
import { AppAbility } from '../casl/ability.factory';
import {
  CHECK_POLICIES_KEY,
  CheckPolicies,
  PolicyHandler,
} from '../decorators/check-policies.decorator';
import { AUTH_ONE_OF_KEY } from '../decorators/auth-one-of.decorator';
import { anAuthUser } from '../testing/auth-fixtures';
import { RequestPrincipal } from './api-key.guard';
import { PoliciesGuard } from './policies.guard';

const contextFor = (user: RequestPrincipal | undefined, method = 'GET'): ExecutionContext =>
  ({
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => ({ user, method }) }),
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

  it('lets a @Public route through, even without a caller (D-061)', () => {
    reflector.getAllAndOverride.mockImplementation((key: string) => key === IS_PUBLIC_KEY);
    expect(guard.canActivate(contextFor(undefined))).toBe(true);
  });

  it('lets an @Authenticated route through with a caller and no policy, and still needs the caller', () => {
    reflector.getAllAndOverride.mockImplementation((key: string) => key === AUTHENTICATED_ONLY_KEY);
    expect(guard.canActivate(contextFor(staff))).toBe(true);
    expect(() => guard.canActivate(contextFor(undefined))).toThrow(
      expect.objectContaining({ errorCode: ErrorCode.UNAUTHENTICATED }) as Error,
    );
  });

  describe('an organization API key (auth task 4.3, AC-05)', () => {
    const key: RequestPrincipal = {
      kind: 'API_KEY',
      apiKeyId: 'key-1',
      accountType: 'ORGANIZATION',
      organization: { id: 'org-1' },
      roles: [],
      ability: createMongoAbility<AppAbility>([
        { action: 'read', subject: 'Incident', conditions: { organizationId: 'org-1' } },
      ]),
    };
    const marked = (others: (key: string) => unknown) => (metadata: string) =>
      metadata === AUTH_ONE_OF_KEY ? ['jwt', 'apiKey'] : others(metadata);

    it('passes a read route marked for keys when the policy allows', () => {
      reflector.getAllAndOverride.mockImplementation(
        marked((metadata) => (metadata === CHECK_POLICIES_KEY ? [canRead] : undefined)),
      );
      expect(guard.canActivate(contextFor(key, 'GET'))).toBe(true);
    });

    it('answers 403 on a mutating route even when it is marked', () => {
      reflector.getAllAndOverride.mockImplementation(
        marked((metadata) => (metadata === CHECK_POLICIES_KEY ? [canRead] : undefined)),
      );
      expect(() => guard.canActivate(contextFor(key, 'POST'))).toThrow(
        expect.objectContaining({ errorCode: ErrorCode.FORBIDDEN }) as Error,
      );
    });

    it.each([
      ['an unmarked read route with an allowing policy', CHECK_POLICIES_KEY],
      ['an @Authenticated route', AUTHENTICATED_ONLY_KEY],
    ])('answers 403 on %s', (_label, granted) => {
      reflector.getAllAndOverride.mockImplementation((metadata: string) =>
        metadata === granted ? (granted === CHECK_POLICIES_KEY ? [canRead] : true) : undefined,
      );
      expect(() => guard.canActivate(contextFor(key, 'GET'))).toThrow(
        expect.objectContaining({ errorCode: ErrorCode.FORBIDDEN }) as Error,
      );
    });

    it('lets a marked @Authenticated read route through', () => {
      reflector.getAllAndOverride.mockImplementation(
        marked((metadata) => metadata === AUTHENTICATED_ONLY_KEY),
      );
      expect(guard.canActivate(contextFor(key, 'GET'))).toBe(true);
    });
  });

  it('answers 401 when no guard authenticated the caller', () => {
    reflector.getAllAndOverride.mockReset();
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
