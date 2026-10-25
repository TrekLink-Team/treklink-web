import { JwtService } from '@nestjs/jwt';
import { AccessTokenAuthenticator } from './access-token-authenticator.service';
import { AccountSessionService } from './account-session.service';
import { aSessionUser } from './testing/auth-fixtures';

describe('AccessTokenAuthenticator', () => {
  let jwt: { verifyAsync: jest.Mock };
  let sessions: { load: jest.Mock };
  let authenticator: AccessTokenAuthenticator;

  beforeEach(() => {
    jwt = { verifyAsync: jest.fn().mockResolvedValue({ sub: 'user-1', exp: 1_792_900_000 }) };
    sessions = { load: jest.fn().mockResolvedValue(aSessionUser()) };
    authenticator = new AccessTokenAuthenticator(
      jwt as unknown as JwtService,
      sessions as unknown as AccountSessionService,
    );
  });

  it('returns the account the token names, rebuilt from the database, with the token expiry', async () => {
    await expect(authenticator.authenticate('access.jwt')).resolves.toEqual({
      user: aSessionUser(),
      expiresAt: 1_792_900_000_000,
    });
    expect(jwt.verifyAsync).toHaveBeenCalledWith('access.jwt', { algorithms: ['HS256'] });
    expect(sessions.load).toHaveBeenCalledWith('user-1');
  });

  it.each([undefined, null, '', 42, {}])('refuses %p without verifying', async (token) => {
    await expect(authenticator.authenticate(token)).resolves.toBeNull();
    expect(jwt.verifyAsync).not.toHaveBeenCalled();
  });

  it('refuses an invalid or expired token', async () => {
    jwt.verifyAsync.mockRejectedValue(new Error('jwt expired'));
    await expect(authenticator.authenticate('old.jwt')).resolves.toBeNull();
    expect(sessions.load).not.toHaveBeenCalled();
  });

  it('refuses an account that may no longer hold a session', async () => {
    sessions.load.mockResolvedValue(null);
    await expect(authenticator.authenticate('access.jwt')).resolves.toBeNull();
  });

  it('refuses when the lookup itself fails', async () => {
    sessions.load.mockRejectedValue(new Error('db down'));
    await expect(authenticator.authenticate('access.jwt')).resolves.toBeNull();
  });
});
