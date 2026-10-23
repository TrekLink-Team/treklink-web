import { ConfigService } from '@nestjs/config';
import { ErrorCode } from '../../../common/errors';
import { ValidatedEnvironment } from '../../platform/config/environment-variables';
import { AccountSessionService } from '../account-session.service';
import { aSessionUser } from '../testing/auth-fixtures';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  const sessions = { load: jest.fn() };
  const config = { get: jest.fn().mockReturnValue('access-secret') };
  const strategy = new JwtStrategy(
    sessions as unknown as AccountSessionService,
    config as unknown as ConfigService<ValidatedEnvironment, true>,
  );
  const payload = { sub: 'user-1', accountType: 'TREKLINK' as const, roles: ['STAFF'], pv: 0 };

  it('verifies with JWT_ACCESS_SECRET', () => {
    expect(config.get).toHaveBeenCalledWith('JWT_ACCESS_SECRET', { infer: true });
  });

  it('rebuilds the caller from the database on every request', async () => {
    sessions.load.mockResolvedValue(aSessionUser({ roles: ['ADMIN'] }));

    await expect(strategy.validate(payload)).resolves.toEqual({
      ...aSessionUser({ roles: ['ADMIN'] }),
      kind: 'USER',
    });
    expect(sessions.load).toHaveBeenCalledWith('user-1');
  });

  it('answers 401 for an account that can no longer hold a session (REQ-EVT-07, AC-04)', async () => {
    sessions.load.mockResolvedValue(null);

    await expect(strategy.validate(payload)).rejects.toMatchObject({
      errorCode: ErrorCode.UNAUTHENTICATED,
    });
  });
});
