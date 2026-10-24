import { Reflector } from '@nestjs/core';
import { createMongoAbility } from '@casl/ability';
import { CHECK_POLICIES_KEY, PolicyHandler } from '../../common/decorators/access.decorator';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { AppAbility } from './casl/ability.factory';
import { PasswordFlowsService } from './password-flows.service';
import { CLIENT } from './testing/auth-fixtures';

const policyOf = (method: keyof AccountsController): PolicyHandler => {
  const descriptor = Object.getOwnPropertyDescriptors(AccountsController.prototype)[method];
  const [policy] = new Reflector().get<PolicyHandler[]>(
    CHECK_POLICIES_KEY,
    descriptor.value as (...args: never[]) => unknown,
  );
  return policy;
};

describe('AccountsController', () => {
  const accounts = {
    list: jest.fn().mockResolvedValue({ items: [] }),
    create: jest.fn().mockResolvedValue({ id: 'staff-2' }),
    update: jest.fn().mockResolvedValue({ id: 'staff-1' }),
    deactivate: jest.fn().mockResolvedValue({ id: 'staff-1', isActive: false }),
    reactivate: jest.fn().mockResolvedValue({ id: 'staff-1', isActive: true }),
  };
  const passwords = { triggerReset: jest.fn().mockResolvedValue(undefined) };
  const controller = new AccountsController(
    accounts as unknown as AccountsService,
    passwords as unknown as PasswordFlowsService,
  );
  const caller = { id: 'admin-1', roles: ['ADMIN'], organizationId: null };

  it.each([
    [undefined, undefined],
    ['true', true],
    ['false', false],
  ] as const)('lists with isActive=%s read as %s (api-design 09)', async (text, flag) => {
    await controller.list({ q: 'tran', isActive: text });
    expect(accounts.list).toHaveBeenLastCalledWith({ q: 'tran', isActive: flag });
  });

  it('creates, updates, deactivates and reactivates for the caller (api-design 10 to 13)', async () => {
    const dto = { email: 'staff2@treklink.vn', fullName: 'Le Van C', role: 'STAFF' as const };
    await controller.create(dto, caller, CLIENT.ip, CLIENT.userAgent);
    expect(accounts.create).toHaveBeenCalledWith(caller, dto, CLIENT);

    await controller.update('staff-1', { role: 'ADMIN' }, caller, CLIENT.ip, CLIENT.userAgent);
    expect(accounts.update).toHaveBeenCalledWith(caller, 'staff-1', { role: 'ADMIN' }, CLIENT);

    await controller.deactivate('staff-1', { reason: 'Left' }, caller, CLIENT.ip, CLIENT.userAgent);
    expect(accounts.deactivate).toHaveBeenCalledWith(caller, 'staff-1', 'Left', CLIENT);

    await controller.reactivate('staff-1', caller, CLIENT.ip, CLIENT.userAgent);
    expect(accounts.reactivate).toHaveBeenCalledWith(caller, 'staff-1', CLIENT);
  });

  it('triggers a reset for the account and returns no result (api-design 14)', async () => {
    await expect(
      controller.triggerPasswordReset('user-1', caller, CLIENT.ip, CLIENT.userAgent),
    ).resolves.toBeNull();
    expect(passwords.triggerReset).toHaveBeenCalledWith(caller, 'user-1', CLIENT);
  });

  it('needs account.manage for administration, which only the Admin holds', () => {
    const admin = createMongoAbility<AppAbility>([{ action: 'manage', subject: 'Account' }]);
    const staff = createMongoAbility<AppAbility>([{ action: 'triggerReset', subject: 'Account' }]);

    for (const method of ['list', 'create', 'update', 'deactivate', 'reactivate'] as const) {
      expect(policyOf(method)(admin)).toBe(true);
      expect(policyOf(method)(staff)).toBe(false);
    }
  });

  it('needs account.triggerReset for the reset, which Staff and Admin hold and members do not', () => {
    const staff = createMongoAbility<AppAbility>([{ action: 'triggerReset', subject: 'Account' }]);
    const admin = createMongoAbility<AppAbility>([{ action: 'manage', subject: 'Account' }]);
    const member = createMongoAbility<AppAbility>([{ action: 'read', subject: 'Incident' }]);

    expect(policyOf('triggerPasswordReset')(staff)).toBe(true);
    expect(policyOf('triggerPasswordReset')(admin)).toBe(true);
    expect(policyOf('triggerPasswordReset')(member)).toBe(false);
  });
});
