import { Reflector } from '@nestjs/core';
import { createMongoAbility } from '@casl/ability';
import { CHECK_POLICIES_KEY, PolicyHandler } from '../../common/decorators/access.decorator';
import { AppAbility } from './casl/ability.factory';
import { PermissionsController, RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { CLIENT } from './testing/auth-fixtures';

describe('RolesController and PermissionsController', () => {
  const roles = {
    list: jest.fn().mockResolvedValue([]),
    catalog: jest.fn().mockResolvedValue([]),
    replacePermissions: jest
      .fn()
      .mockResolvedValue({ id: 'r-1', key: 'STAFF', permissionCount: 1 }),
  };
  const caller = { id: 'admin-1', roles: ['ADMIN'], organizationId: null };

  it('lists roles, replaces a permission set and serves the catalog (api-design 15, 16, 18)', async () => {
    const controller = new RolesController(roles as unknown as RolesService);
    await controller.list();
    await controller.replacePermissions(
      'r-1',
      { permissionKeys: ['incident.read'] },
      caller,
      CLIENT.ip,
      CLIENT.userAgent,
    );
    await new PermissionsController(roles as unknown as RolesService).catalog();

    expect(roles.list).toHaveBeenCalled();
    expect(roles.replacePermissions).toHaveBeenCalledWith(caller, 'r-1', ['incident.read'], CLIENT);
    expect(roles.catalog).toHaveBeenCalled();
  });

  it.each([RolesController, PermissionsController])(
    '%p needs role.manage, which only the Admin holds',
    (controller) => {
      const [policy] = new Reflector().get<PolicyHandler[]>(CHECK_POLICIES_KEY, controller);
      expect(policy(createMongoAbility<AppAbility>([{ action: 'manage', subject: 'Role' }]))).toBe(
        true,
      );
      expect(
        policy(createMongoAbility<AppAbility>([{ action: 'triggerReset', subject: 'Account' }])),
      ).toBe(false);
    },
  );
});
