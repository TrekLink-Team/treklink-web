import { DomainException, ErrorCode } from '../../../common/errors';
import { aSessionUser } from '../testing/auth-fixtures';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard.handleRequest', () => {
  const guard = new JwtAuthGuard();

  it('passes the authenticated user through', () => {
    const user = { ...aSessionUser(), kind: 'USER' as const };
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
