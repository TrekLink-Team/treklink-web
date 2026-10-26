import { ExecutionContext } from '@nestjs/common';
import { callerOf } from '../../../common/decorators/access.decorator';
import { ErrorCode } from '../../../common/errors';
import { anAuthUser } from '../testing/auth-fixtures';
import { currentPrincipalOf } from './current-user.decorator';

const contextWith = (user: unknown): ExecutionContext =>
  ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as unknown as ExecutionContext;

const KEY_CALLER = {
  kind: 'API_KEY',
  apiKeyId: 'key-1',
  accountType: 'ORGANIZATION',
  organization: { id: 'org-1' },
  roles: [],
};

describe('request principal accessors (auth task 4.3)', () => {
  it('currentPrincipalOf returns an account or an API key caller as set', () => {
    const user = anAuthUser();
    expect(currentPrincipalOf(undefined, contextWith(user))).toBe(user);
    expect(currentPrincipalOf(undefined, contextWith(KEY_CALLER))).toBe(KEY_CALLER);
  });

  it('callerOf returns the account caller', () => {
    const member = anAuthUser({
      id: 'manager-1',
      roles: ['ORG_MANAGER'],
      organization: {
        id: 'org-1',
        code: 'ORG-0001',
        legalName: 'ACME',
        status: 'ACTIVE',
        memberRole: 'MANAGER',
      },
    });
    expect(callerOf(undefined, contextWith(member))).toEqual({
      id: 'manager-1',
      roles: ['ORG_MANAGER'],
      organizationId: 'org-1',
    });
    expect(callerOf(undefined, contextWith(anAuthUser()))).toMatchObject({ organizationId: null });
  });

  it('callerOf refuses an API key with 403, which acts as no account (BR-20)', () => {
    expect(() => callerOf(undefined, contextWith(KEY_CALLER))).toThrow(
      expect.objectContaining({
        errorCode: ErrorCode.FORBIDDEN,
        message: 'You do not have access to this.',
      }) as Error,
    );
  });
});
