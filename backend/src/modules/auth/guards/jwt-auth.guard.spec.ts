import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../../common/errors';
import { anAuthUser } from '../testing/auth-fixtures';
import { ApiKeyGuard } from './api-key.guard';
import { JwtAuthGuard } from './jwt-auth.guard';

const apiKeys = { canActivate: jest.fn().mockResolvedValue(true) };

const contextWith = (headers: Record<string, string> = {}): ExecutionContext =>
  ({
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  }) as unknown as ExecutionContext;

describe('JwtAuthGuard.handleRequest', () => {
  const guard = new JwtAuthGuard(new Reflector(), apiKeys as unknown as ApiKeyGuard);

  it('passes the authenticated user through', () => {
    const user = anAuthUser();
    expect(guard.handleRequest(null, user)).toBe(user);
  });

  it.each([
    ['no token', null, false],
    ['a passport error', new Error('jwt malformed'), false],
  ])('answers 401 UNAUTHENTICATED for %s (FR-AUTH-01)', (_label, error, user) => {
    expect(() => guard.handleRequest(error, user)).toThrow(
      expect.objectContaining({
        errorCode: ErrorCode.UNAUTHENTICATED,
        message: 'Authentication required.',
      }) as Error,
    );
  });

  it('rethrows a DomainException from the strategy unchanged', () => {
    const fromStrategy = new DomainException(401, ErrorCode.UNAUTHENTICATED, 'x');
    expect(() => guard.handleRequest(fromStrategy, false)).toThrow(fromStrategy);
  });
});

describe('JwtAuthGuard.canActivate (D-061, auth task 4.3)', () => {
  const notPublic = { getAllAndOverride: jest.fn().mockReturnValue(false) };

  beforeEach(() => apiKeys.canActivate.mockClear());

  it('lets a @Public route through without reading a token', () => {
    const reflector = { getAllAndOverride: jest.fn((key: string) => key === IS_PUBLIC_KEY) };
    const guard = new JwtAuthGuard(
      reflector as unknown as Reflector,
      apiKeys as unknown as ApiKeyGuard,
    );
    expect(guard.canActivate(contextWith({ 'x-api-key': 'tlk_x' }))).toBe(true);
    expect(apiKeys.canActivate).not.toHaveBeenCalled();
  });

  it('hands a request with an X-Api-Key and no bearer token to ApiKeyGuard', async () => {
    const guard = new JwtAuthGuard(
      notPublic as unknown as Reflector,
      apiKeys as unknown as ApiKeyGuard,
    );
    const context = contextWith({ 'x-api-key': 'tlk_x' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(apiKeys.canActivate).toHaveBeenCalledWith(context);
  });

  it('keeps the bearer token path when both are sent, or no key is sent', () => {
    const guard = new JwtAuthGuard(
      notPublic as unknown as Reflector,
      apiKeys as unknown as ApiKeyGuard,
    );
    const parent = Object.getPrototypeOf(JwtAuthGuard.prototype) as {
      canActivate: (context: ExecutionContext) => unknown;
    };
    const passport = jest.spyOn(parent, 'canActivate').mockReturnValue(true);

    expect(
      guard.canActivate(contextWith({ authorization: 'Bearer t', 'x-api-key': 'tlk_x' })),
    ).toBe(true);
    expect(guard.canActivate(contextWith({}))).toBe(true);
    expect(passport).toHaveBeenCalledTimes(2);
    expect(apiKeys.canActivate).not.toHaveBeenCalled();
    passport.mockRestore();
  });
});
