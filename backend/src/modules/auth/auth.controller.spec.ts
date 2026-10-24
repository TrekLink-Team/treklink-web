import { ExecutionContext } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordFlowsService } from './password-flows.service';
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
  const passwords = {
    forgot: jest.fn().mockResolvedValue(undefined),
    reset: jest.fn().mockResolvedValue(undefined),
    setPassword: jest.fn().mockResolvedValue(signedIn),
    change: jest.fn().mockResolvedValue(undefined),
  };
  const controller = new AuthController(
    auth as unknown as AuthService,
    passwords as unknown as PasswordFlowsService,
  );

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

  it('forgot passes the email and returns no result (api-design 05)', async () => {
    await expect(
      controller.forgotPassword({ email: 'a@treklink.vn' }, CLIENT.ip, CLIENT.userAgent),
    ).resolves.toBeNull();
    expect(passwords.forgot).toHaveBeenCalledWith('a@treklink.vn', CLIENT);
  });

  it('reset maps newPassword and returns no result (api-design 06)', async () => {
    await expect(
      controller.resetPassword(
        { email: 'a@treklink.vn', code: '482913', newPassword: 'new-password' },
        CLIENT.ip,
        CLIENT.userAgent,
      ),
    ).resolves.toBeNull();
    expect(passwords.reset).toHaveBeenCalledWith(
      { email: 'a@treklink.vn', code: '482913', password: 'new-password' },
      CLIENT,
    );
  });

  it('set password signs the user in (api-design 07)', async () => {
    const dto = { email: 'a@treklink.vn', code: '739104', password: 'new-password' };
    await expect(controller.setPassword(dto, CLIENT.ip, CLIENT.userAgent)).resolves.toBe(signedIn);
    expect(passwords.setPassword).toHaveBeenCalledWith(dto, CLIENT);
  });

  it('change password acts for the caller and returns no result (api-design 08)', async () => {
    const dto = { currentPassword: 'old-password', newPassword: 'new-password' };
    await expect(
      controller.changePassword(user, dto, CLIENT.ip, CLIENT.userAgent),
    ).resolves.toBeNull();
    expect(passwords.change).toHaveBeenCalledWith('user-1', dto, CLIENT);
  });
});
