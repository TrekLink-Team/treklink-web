import { ConfigService } from '@nestjs/config';
import { createMongoAbility } from '@casl/ability';
import { ErrorCode } from '../../../common/errors';
import { ValidatedEnvironment } from '../../platform/config/environment-variables';
import { AccountSessionService } from '../account-session.service';
import { AbilityFactory, AppAbility } from '../casl/ability.factory';
import { aSessionUser } from '../testing/auth-fixtures';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  const ability = createMongoAbility<AppAbility>([{ action: 'read', subject: 'Incident' }]);
  const sessions = { load: jest.fn() };
  const abilities = { forContext: jest.fn().mockResolvedValue(ability) };
  const config = { get: jest.fn().mockReturnValue('access-secret') };
  const strategy = new JwtStrategy(
    sessions as unknown as AccountSessionService,
    abilities as unknown as AbilityFactory,
    config as unknown as ConfigService<ValidatedEnvironment, true>,
  );
  const payload = { sub: 'user-1', accountType: 'TREKLINK' as const, roles: ['STAFF'], pv: 0 };

  beforeEach(() => abilities.forContext.mockClear());

  it('verifies with JWT_ACCESS_SECRET', () => {
    expect(config.get).toHaveBeenCalledWith('JWT_ACCESS_SECRET', { infer: true });
  });

  it('rebuilds the caller and its ability from the database on every request', async () => {
    sessions.load.mockResolvedValue(aSessionUser({ roles: ['ADMIN'] }));

    await expect(strategy.validate(payload)).resolves.toEqual({
      ...aSessionUser({ roles: ['ADMIN'] }),
      kind: 'USER',
      ability,
    });
    expect(sessions.load).toHaveBeenCalledWith('user-1');
    expect(abilities.forContext).toHaveBeenCalledWith({
      userId: 'user-1',
      organizationId: null,
      roles: ['ADMIN'],
    });
  });

  it('builds a member ability on the organization of the database row, not the token', async () => {
    sessions.load.mockResolvedValue(
      aSessionUser({
        accountType: 'ORGANIZATION',
        roles: ['ORG_OPERATOR'],
        organization: { id: 'org-a', status: 'ACTIVE', memberRole: 'OPERATOR' },
      }),
    );

    await strategy.validate({ ...payload, organizationId: 'org-b' });
    expect(abilities.forContext).toHaveBeenCalledWith({
      userId: 'user-1',
      organizationId: 'org-a',
      roles: ['ORG_OPERATOR'],
    });
  });

  it('answers 401 for an account that can no longer hold a session (REQ-EVT-07, AC-04)', async () => {
    sessions.load.mockResolvedValue(null);

    await expect(strategy.validate(payload)).rejects.toMatchObject({
      errorCode: ErrorCode.UNAUTHENTICATED,
    });
    expect(abilities.forContext).not.toHaveBeenCalled();
  });
});
