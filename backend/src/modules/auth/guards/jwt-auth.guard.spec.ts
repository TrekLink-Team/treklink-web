import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../../common/errors';
import { anAuthUser } from '../testing/auth-fixtures';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard.handleRequest', () => {
  const guard = new JwtAuthGuard(new Reflector());

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

describe('JwtAuthGuard.canActivate (D-061)', () => {
  it('lets a @Public route through without reading a token', () => {
    const reflector = { getAllAndOverride: jest.fn((key: string) => key === IS_PUBLIC_KEY) };
    const guard = new JwtAuthGuard(reflector as unknown as Reflector);
    const context = {
      getHandler: () => function handler() {},
      getClass: () => class Controller {},
    } as unknown as ExecutionContext;
    expect(guard.canActivate(context)).toBe(true);
  });
});
