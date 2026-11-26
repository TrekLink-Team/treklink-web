import { HttpStatus, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { createMongoAbility } from '@casl/ability';
import { CHECK_POLICIES_KEY, PolicyHandler } from '../../common/decorators/access.decorator';
import { RESPONSE_MESSAGE_KEY } from '../../common/decorators/response-message.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { AppAbility } from './casl/ability.factory';
import {
  OrganizationRolePolicyService,
  OrganizationRoleSaved,
  OrganizationRolesResult,
} from './organization-role-policy.service';
import { OrganizationRolesController } from './organization-roles.controller';
import { CLIENT } from './testing/auth-fixtures';

// auth task 9.4, api-design 19 and 20 (D-095): the Org Manager's view and edit of its two roles.
describe('OrganizationRolesController', () => {
  const manager = { id: 'manager-1', roles: ['ORG_MANAGER'], organizationId: 'org-1' };
  const viewResult = { roles: [], catalog: [] } as unknown as OrganizationRolesResult;
  const saved = {
    key: 'ORG_STAFF',
    version: 4,
    effectiveKeys: ['incident.read'],
  } as unknown as OrganizationRoleSaved;

  let policies: { view: jest.Mock; replace: jest.Mock };
  let controller: OrganizationRolesController;

  beforeEach(() => {
    policies = {
      view: jest.fn().mockResolvedValue(viewResult),
      replace: jest.fn().mockResolvedValue(saved),
    };
    controller = new OrganizationRolesController(
      policies as unknown as OrganizationRolePolicyService,
    );
  });

  describe('view (api-design 19)', () => {
    it('reads the roles of the caller and returns the service result as is', async () => {
      await expect(controller.view(manager)).resolves.toBe(viewResult);
      expect(policies.view).toHaveBeenCalledWith(manager);
    });

    it('lets a refusal from the service reach the exception filter', async () => {
      const refused = new DomainException(
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
        'You do not have access to this.',
      );
      policies.view.mockRejectedValueOnce(refused);
      await expect(controller.view(manager)).rejects.toBe(refused);
    });
  });

  describe('replace (api-design 20)', () => {
    it('passes the role key, the permission keys, the expected version and the client', async () => {
      await expect(
        controller.replace(
          'ORG_STAFF',
          { permissionKeys: ['incident.read'], expectedVersion: 3 },
          manager,
          CLIENT.ip,
          CLIENT.userAgent,
        ),
      ).resolves.toBe(saved);
      expect(policies.replace).toHaveBeenCalledWith(
        manager,
        'ORG_STAFF',
        ['incident.read'],
        3,
        CLIENT,
      );
    });

    it('records a missing ip and user agent as null, not undefined', async () => {
      await controller.replace(
        'ORG_STAFF',
        { permissionKeys: [], expectedVersion: 0 },
        manager,
        undefined,
        undefined,
      );
      expect(policies.replace).toHaveBeenCalledWith(manager, 'ORG_STAFF', [], 0, {
        ip: null,
        userAgent: null,
      });
    });

    it('lets the 409 on a stale version reach the exception filter', async () => {
      const stale = new DomainException(
        HttpStatus.CONFLICT,
        ErrorCode.STALE_VERSION,
        'The role was changed by someone else.',
      );
      policies.replace.mockRejectedValueOnce(stale);
      await expect(
        controller.replace(
          'ORG_STAFF',
          { permissionKeys: ['incident.read'], expectedVersion: 2 },
          manager,
          CLIENT.ip,
          CLIENT.userAgent,
        ),
      ).rejects.toMatchObject({ httpStatus: HttpStatus.CONFLICT, errorCode: 'STALE_VERSION' });
    });
  });

  describe('access', () => {
    const [policy] = new Reflector().get<PolicyHandler[]>(
      CHECK_POLICIES_KEY,
      OrganizationRolesController,
    );

    it('needs manage on OrganizationRole, the Org Manager permission', () => {
      expect(
        policy(createMongoAbility<AppAbility>([{ action: 'manage', subject: 'OrganizationRole' }])),
      ).toBe(true);
    });

    it.each([
      ['read on OrganizationRole', [{ action: 'read', subject: 'OrganizationRole' }]],
      ['manage on Role, the TrekLink Admin permission', [{ action: 'manage', subject: 'Role' }]],
      ['no permission at all', []],
    ])('refuses a caller with %s', (_label, rules) => {
      expect(policy(createMongoAbility<AppAbility>(rules as never))).toBe(false);
    });
  });

  describe('routes', () => {
    const handler = (name: string) =>
      (OrganizationRolesController.prototype as unknown as Record<string, object>)[name];

    it('is mounted on organization/roles, with no organization id in the path', () => {
      expect(Reflect.getMetadata(PATH_METADATA, OrganizationRolesController)).toBe(
        'organization/roles',
      );
    });

    it.each([
      { name: 'view', verb: 'GET', method: RequestMethod.GET, path: '/', message: 'OK' },
      {
        name: 'replace',
        verb: 'PUT',
        method: RequestMethod.PUT,
        path: ':roleKey/permissions',
        message: 'Permissions updated',
      },
    ])('$name is $verb $path with the message "$message"', ({ name, method, path, message }) => {
      expect(Reflect.getMetadata(METHOD_METADATA, handler(name))).toBe(method);
      expect(Reflect.getMetadata(PATH_METADATA, handler(name))).toBe(path);
      expect(Reflect.getMetadata(RESPONSE_MESSAGE_KEY, handler(name))).toBe(message);
    });
  });
});
