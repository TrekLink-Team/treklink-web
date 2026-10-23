import { ExecutionContext } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { currentUserOf } from './decorators/current-user.decorator';
import { anAuthUser, aSessionUser, CLIENT } from './testing/auth-fixtures';

describe('AuthController', () => {
  const user = anAuthUser();
  const signedIn = {
    accessToken: 'a',
    accessTokenExpiresIn: 900,
    refreshToken: 'r',
    refreshTokenExpiresIn: 60,
    user,
  };
  const auth = {
    login: jest.fn().mockResolvedValue(signedIn),
    refresh: jest.fn().mockResolvedValue(signedIn),
    logout: jest.fn().mockResolvedValue(undefined),
    me: jest.fn().mockResolvedValue(aSessionUser()),
  };
  const controller = new AuthController(auth as unknown as AuthService);

  it('login passes the credentials with the client ip and user agent', async () => {
    const dto = { email: 'staff@treklink.vn', password: 'p' };
    await expect(controller.login(dto, CLIENT.ip, CLIENT.userAgent)).resolves.toBe(signedIn);
    expect(auth.login).toHaveBeenCalledWith(dto, CLIENT);
  });

  it('refresh records a missing ip and user agent as null', async () => {
    await controller.refresh({ refreshToken: 'rt_x' }, undefined, undefined);
    expect(auth.refresh).toHaveBeenCalledWith('rt_x', { ip: null, userAgent: null });
  });

  it('logout revokes the token of the caller and returns no result', async () => {
    await expect(
      controller.logout(user, { refreshToken: 'rt_x' }, CLIENT.ip, CLIENT.userAgent),
    ).resolves.toBeNull();
    expect(auth.logout).toHaveBeenCalledWith('user-1', 'rt_x', CLIENT);
  });

  it('me answers for the caller', async () => {
    await expect(controller.me(user)).resolves.toEqual(aSessionUser());
    expect(auth.me).toHaveBeenCalledWith('user-1');
  });

  it('@CurrentUser reads the user the guard set on the request', () => {
    const context = {
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext;
    expect(currentUserOf(undefined, context)).toBe(user);
  });
});
