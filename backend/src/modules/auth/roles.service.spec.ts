import { AccountType, Prisma } from '@prisma/client';
import { ErrorCode } from '../../common/errors';
import { AUDIT_RECORD } from '../platform/audit/audit-record.event';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { AccountsRepository, CatalogPermissionRow, RoleView } from './accounts.repository';
import { POLICY_CHANGED } from './casl/permission-cache';
import { RolesService, scopeOf } from './roles.service';
import { CLIENT } from './testing/auth-fixtures';

const tx = { tx: true } as unknown as Prisma.TransactionClient;
const ADMIN = { id: 'admin-1', roles: ['ADMIN'], organizationId: null };

const permission = (
  key: string,
  accountType: AccountType,
  conditions: Prisma.JsonValue = null,
): CatalogPermissionRow => ({
  id: `p-${key}`,
  key,
  action: key.split('.')[1],
  subject: key.split('.')[0],
  accountType,
  conditions,
});

const role = (key: string, accountType: AccountType, permissionKeys: string[] = []): RoleView => ({
  id: `r-${key}`,
  key,
  accountType,
  isSystem: true,
  permissionKeys,
});

const CATALOG = [
  permission('incident.read.own', AccountType.ORGANIZATION, {
    organizationId: '${user.organizationId}',
  }),
  permission('organization.decide', AccountType.TREKLINK),
  permission('role.manage', AccountType.TREKLINK),
];

describe('scopeOf', () => {
  it("reads `own` from a condition bound to the caller's organization, `any` otherwise", () => {
    expect(scopeOf({ organizationId: '${user.organizationId}' })).toBe('own');
    expect(scopeOf({ createdById: '${user.id}' })).toBe('any');
    expect(scopeOf(null)).toBe('any');
  });
});

describe('RolesService', () => {
  let accounts: Record<string, jest.Mock>;
  let events: { transaction: jest.Mock; emitAfterCommit: jest.Mock };
  let service: RolesService;

  beforeEach(() => {
    accounts = {
      listRoles: jest.fn().mockResolvedValue([role('ADMIN', AccountType.TREKLINK)]),
      findRole: jest.fn(),
      listPermissions: jest.fn((keys?: string[]) =>
        Promise.resolve(keys ? CATALOG.filter((row) => keys.includes(row.key)) : CATALOG),
      ),
      replaceRolePermissions: jest.fn().mockResolvedValue(undefined),
    };
    events = {
      transaction: jest.fn((work: (client: Prisma.TransactionClient) => unknown) => work(tx)),
      emitAfterCommit: jest.fn(),
    };
    service = new RolesService(
      accounts as unknown as AccountsRepository,
      events as unknown as TransactionalEvents,
    );
  });

  it('lists the roles with their permission keys (api-design 15)', async () => {
    await expect(service.list()).resolves.toEqual([role('ADMIN', AccountType.TREKLINK)]);
  });

  it('serves the catalog with scope and protected, never the raw condition (api-design 18)', async () => {
    const catalog = await service.catalog();

    expect(catalog[0]).toEqual({
      key: 'incident.read.own',
      action: 'read',
      subject: 'incident',
      scope: 'own',
      accountType: AccountType.ORGANIZATION,
      description: null,
      protected: false,
    });
    expect(catalog.find((item) => item.key === 'role.manage')).toMatchObject({
      scope: 'any',
      protected: true,
    });
    expect(Object.keys(catalog[0])).not.toContain('conditions');
  });

  describe('replacePermissions (api-design 16)', () => {
    it('replaces the set, applies it on the next request and audits before and after (AC-03)', async () => {
      accounts.findRole.mockResolvedValue(
        role('ORG_OPERATOR', AccountType.ORGANIZATION, ['liveMap.read.own']),
      );

      await expect(
        service.replacePermissions(
          ADMIN,
          'r-ORG_OPERATOR',
          ['incident.read.own', 'incident.read.own'],
          CLIENT,
        ),
      ).resolves.toEqual({ id: 'r-ORG_OPERATOR', key: 'ORG_OPERATOR', permissionCount: 1 });

      expect(accounts.listPermissions).toHaveBeenCalledWith(['incident.read.own'], tx);
      expect(accounts.replaceRolePermissions).toHaveBeenCalledWith(
        'r-ORG_OPERATOR',
        ['p-incident.read.own'],
        tx,
      );
      expect(events.emitAfterCommit).toHaveBeenCalledWith(POLICY_CHANGED, {
        roleId: 'r-ORG_OPERATOR',
      });
      expect(events.emitAfterCommit).toHaveBeenCalledWith(
        AUDIT_RECORD,
        expect.objectContaining({
          action: 'role.permissions',
          subjectType: 'Role',
          before: { permissionKeys: ['liveMap.read.own'] },
          after: { permissionKeys: ['incident.read.own'] },
        }),
      );
    });

    it('answers 404 for an unknown role', async () => {
      accounts.findRole.mockResolvedValue(null);

      await expect(service.replacePermissions(ADMIN, 'r-x', [], CLIENT)).rejects.toMatchObject({
        errorCode: ErrorCode.NOT_FOUND,
        message: 'Role not found.',
      });
    });

    it('refuses a key outside the catalog (UNKNOWN_PERMISSION)', async () => {
      accounts.findRole.mockResolvedValue(role('STAFF', AccountType.TREKLINK));

      await expect(
        service.replacePermissions(ADMIN, 'r-STAFF', ['x'], CLIENT),
      ).rejects.toMatchObject({
        errorCode: ErrorCode.UNKNOWN_PERMISSION,
        message: 'Unknown permission: x.',
      });
      expect(accounts.replaceRolePermissions).not.toHaveBeenCalled();
    });

    it.each([
      [
        'an organization role',
        role('ORG_MANAGER', AccountType.ORGANIZATION),
        'organization.decide',
        'organization.decide cannot be granted to an organization role.',
      ],
      [
        'a TrekLink role',
        role('STAFF', AccountType.TREKLINK),
        'incident.read.own',
        'incident.read.own cannot be granted to a TrekLink role.',
      ],
    ])(
      'refuses a permission of the other account type for %s (PERMISSION_SCOPE_MISMATCH)',
      async (_label, target, key, message) => {
        accounts.findRole.mockResolvedValue(target);

        await expect(
          service.replacePermissions(ADMIN, target.id, [key], CLIENT),
        ).rejects.toMatchObject({ errorCode: ErrorCode.PERMISSION_SCOPE_MISMATCH, message });
        expect(accounts.replaceRolePermissions).not.toHaveBeenCalled();
      },
    );

    it('refuses to take role.manage from ADMIN (ADMIN_LOCKOUT, MSG38)', async () => {
      accounts.findRole.mockResolvedValue(role('ADMIN', AccountType.TREKLINK, ['role.manage']));

      await expect(
        service.replacePermissions(ADMIN, 'r-ADMIN', ['organization.decide'], CLIENT),
      ).rejects.toMatchObject({
        errorCode: ErrorCode.ADMIN_LOCKOUT,
        message: 'Admins must keep the right to manage roles.',
      });
    });

    it('lets ADMIN change its other permissions while it keeps role.manage', async () => {
      accounts.findRole.mockResolvedValue(role('ADMIN', AccountType.TREKLINK, ['role.manage']));

      await expect(
        service.replacePermissions(
          ADMIN,
          'r-ADMIN',
          ['role.manage', 'organization.decide'],
          CLIENT,
        ),
      ).resolves.toMatchObject({ permissionCount: 2 });
    });
  });
});
