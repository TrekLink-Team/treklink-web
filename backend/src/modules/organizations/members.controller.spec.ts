import { createMongoAbility } from '@casl/ability';
import { Reflector } from '@nestjs/core';
import { MemberRole } from '@prisma/client';
import {
  CHECK_POLICIES_KEY,
  Caller,
  PolicyHandler,
} from '../../common/decorators/access.decorator';
import { AppAbility } from '../auth/casl/ability.factory';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';

const CALLER: Caller = { id: 'u-mgr', roles: ['ORG_MANAGER'], organizationId: 'org-1' };
const VIEW = { id: 'm-1' };

const policyOf = (method: keyof MembersController): PolicyHandler => {
  const descriptor = Object.getOwnPropertyDescriptors(MembersController.prototype)[method];
  const [policy] = new Reflector().get<PolicyHandler[]>(
    CHECK_POLICIES_KEY,
    descriptor.value as (...args: never[]) => unknown,
  );
  return policy;
};

describe('MembersController (api-design 13 to 15)', () => {
  let service: { invite: jest.Mock; changeRole: jest.Mock; deactivate: jest.Mock };
  let controller: MembersController;

  beforeEach(() => {
    service = {
      invite: jest.fn().mockResolvedValue(VIEW),
      changeRole: jest.fn().mockResolvedValue(VIEW),
      deactivate: jest.fn().mockResolvedValue(VIEW),
    };
    controller = new MembersController(service as unknown as MembersService);
  });

  it.each(['invite', 'changeRole', 'deactivate'] as const)(
    'lets only a holder of manage Member through %s',
    (method) => {
      const manager = createMongoAbility([{ action: 'manage', subject: 'Member' }]);
      const reader = createMongoAbility([{ action: 'read', subject: 'Member' }]);
      expect(policyOf(method)(manager as unknown as AppAbility)).toBe(true);
      expect(policyOf(method)(reader as unknown as AppAbility)).toBe(false);
    },
  );

  it('invites with the email lower-cased and the names trimmed', async () => {
    const result = await controller.invite(
      'org-1',
      { email: '  Operator@Example.COM ', fullName: '  Pham Van D ', role: MemberRole.OPERATOR },
      CALLER,
    );

    expect(result).toBe(VIEW);
    expect(service.invite).toHaveBeenCalledWith(
      'org-1',
      { email: 'operator@example.com', fullName: 'Pham Van D', role: MemberRole.OPERATOR },
      CALLER,
    );
  });

  it('changes a role through the service', async () => {
    await expect(
      controller.changeRole('org-1', 'm-1', { role: MemberRole.MANAGER }, CALLER),
    ).resolves.toBe(VIEW);
    expect(service.changeRole).toHaveBeenCalledWith('org-1', 'm-1', MemberRole.MANAGER, CALLER);
  });

  it('deactivates with the reason trimmed, and without one when it is blank or absent', async () => {
    await controller.deactivate('org-1', 'm-1', { reason: '  Left the company ' }, CALLER);
    expect(service.deactivate).toHaveBeenLastCalledWith('org-1', 'm-1', 'Left the company', CALLER);

    await controller.deactivate('org-1', 'm-1', { reason: '   ' }, CALLER);
    expect(service.deactivate).toHaveBeenLastCalledWith('org-1', 'm-1', undefined, CALLER);

    await controller.deactivate('org-1', 'm-1', {}, CALLER);
    expect(service.deactivate).toHaveBeenLastCalledWith('org-1', 'm-1', undefined, CALLER);
  });
});
