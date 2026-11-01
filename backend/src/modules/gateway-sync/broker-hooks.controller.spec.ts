import { ExecutionContext, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isPublic } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { BrokerHookSecretGuard } from './broker-hook-secret.guard';
import { BrokerAuthController } from './broker-hooks.controller';
import { BrokerAuthService } from './broker-hooks.service';

const contextWith = (headers: Record<string, string | string[]>): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
    getHandler: () =>
      Object.getOwnPropertyDescriptor(BrokerAuthController.prototype, 'user')?.value as unknown,
    getClass: () => BrokerAuthController,
  }) as unknown as ExecutionContext;

describe('BrokerAuthController and BrokerHookSecretGuard (api-design 01 and 02)', () => {
  let brokerAuth: { assertSecret: jest.Mock; checkUser: jest.Mock; checkAcl: jest.Mock };

  beforeEach(() => {
    brokerAuth = {
      assertSecret: jest.fn(),
      checkUser: jest.fn().mockResolvedValue({ allowed: true, kind: 'FIELD_STATION' }),
      checkAcl: jest.fn().mockReturnValue({ allowed: true }),
    };
  });

  it('is public to the JWT guard: the broker carries no user token', () => {
    expect(isPublic(new Reflector(), contextWith({}))).toBe(true);
  });

  it('hands the user and ACL bodies to the service', async () => {
    const controller = new BrokerAuthController(brokerAuth as unknown as BrokerAuthService);
    const user = { username: 'fs-org-0007-1', password: 's', clientid: 'c' };
    await expect(controller.user(user)).resolves.toEqual({ allowed: true, kind: 'FIELD_STATION' });
    expect(brokerAuth.checkUser).toHaveBeenCalledWith(user);

    const acl = { username: 'fs-org-0007-1', clientid: 'c', topic: 'treklink/fs/x/health', acc: 2 };
    expect(controller.acl(acl)).toEqual({ allowed: true });
    expect(brokerAuth.checkAcl).toHaveBeenCalledWith(acl);
  });

  it('passes the X-Broker-Secret header to the secret check', () => {
    const guard = new BrokerHookSecretGuard(brokerAuth as unknown as BrokerAuthService);
    expect(guard.canActivate(contextWith({ 'x-broker-secret': 'abc' }))).toBe(true);
    expect(brokerAuth.assertSecret).toHaveBeenCalledWith('abc');
  });

  it('lets the 401 BROKER_SECRET of a missing header through', () => {
    brokerAuth.assertSecret.mockImplementation(() => {
      throw new DomainException(HttpStatus.UNAUTHORIZED, ErrorCode.BROKER_SECRET, 'x');
    });
    const guard = new BrokerHookSecretGuard(brokerAuth as unknown as BrokerAuthService);
    expect(() => guard.canActivate(contextWith({}))).toThrow(DomainException);
    expect(brokerAuth.assertSecret).toHaveBeenCalledWith(undefined);
  });
});
