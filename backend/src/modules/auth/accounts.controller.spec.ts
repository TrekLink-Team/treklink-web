import { Reflector } from '@nestjs/core';
import { createMongoAbility } from '@casl/ability';
import { CHECK_POLICIES_KEY, PolicyHandler } from '../../common/decorators/access.decorator';
import { AccountsController } from './accounts.controller';
import { AppAbility } from './casl/ability.factory';
import { PasswordFlowsService } from './password-flows.service';
import { CLIENT } from './testing/auth-fixtures';

describe('AccountsController', () => {
  const passwords = { triggerReset: jest.fn().mockResolvedValue(undefined) };
  const controller = new AccountsController(passwords as unknown as PasswordFlowsService);
  const caller = { id: 'staff-1', roles: ['STAFF'], organizationId: null };

  it('triggers a reset for the account and returns no result (api-design 14)', async () => {
    await expect(
      controller.triggerPasswordReset('user-1', caller, CLIENT.ip, CLIENT.userAgent),
    ).resolves.toBeNull();
    expect(passwords.triggerReset).toHaveBeenCalledWith(caller, 'user-1', CLIENT);
  });

  it('needs account.triggerReset, which Staff and Admin hold and members do not', () => {
    const { triggerPasswordReset } = Object.getOwnPropertyDescriptors(AccountsController.prototype);
    const [policy] = new Reflector().get<PolicyHandler[]>(
      CHECK_POLICIES_KEY,
      triggerPasswordReset.value as (...args: never[]) => unknown,
    );

    const staff = createMongoAbility<AppAbility>([{ action: 'triggerReset', subject: 'Account' }]);
    const member = createMongoAbility<AppAbility>([{ action: 'read', subject: 'Incident' }]);
    expect(policy(staff)).toBe(true);
    expect(policy(member)).toBe(false);
  });
});
