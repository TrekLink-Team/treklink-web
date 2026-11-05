import { OrganizationRoleEffect } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { ErrorCode } from '../../common/errors';
import { AUDIT_RECORD } from '../platform/audit/audit-record.event';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { AccountsRepository, PermissionRuleRow } from './accounts.repository';
import { POLICY_CHANGED } from './casl/permission-cache';
import { OrganizationRolePolicyRepository } from './organization-role-policy.repository';
import { OrganizationRolePolicyService } from './organization-role-policy.service';

const rule = (key: string, subject = 'Incident'): PermissionRuleRow => ({
  key,
  action: 'read',
  subject,
  conditions: { organizationId: '${user.organizationId}' },
  fields: [],
  inverted: false,
  reason: null,
});

const OPERATOR_ROWS = [rule('incident.read.own'), rule('incident.respond.own')];
const MANAGER_ROWS = [
  ...OPERATOR_ROWS,
  rule('member.manage.own', 'Member'),
  rule('organizationRole.manage.own', 'OrganizationRole'),
];
const IDS = new Map(MANAGER_ROWS.map((row) => [row.key, `id-${row.key}`]));

const MANAGER: Caller = { id: 'manager-a', roles: ['ORG_MANAGER'], organizationId: 'org-a' };
const CLIENT = { ip: '10.0.0.1', userAgent: 'jest' };
const NONE = { grants: [], revokes: [], version: 0, updatedAt: null };

describe('OrganizationRolePolicyService (auth task 9.3, design §9)', () => {
  const tx = { tx: true };
  let accounts: { findRolePermissions: jest.Mock; listPermissions: jest.Mock };
  let policies: {
    findStored: jest.Mock;
    findRoleByKey: jest.Mock;
    lockVersion: jest.Mock;
    replaceStored: jest.Mock;
  };
  let events: { transaction: jest.Mock; emitAfterCommit: jest.Mock };
  let context: { forUser: jest.Mock; lockOrganizationStatus: jest.Mock };
  let service: OrganizationRolePolicyService;

  beforeEach(() => {
    accounts = {
      findRolePermissions: jest.fn((key: string) =>
        Promise.resolve(key === 'ORG_MANAGER' ? MANAGER_ROWS : OPERATOR_ROWS),
      ),
      listPermissions: jest.fn((keys: string[]) =>
        Promise.resolve(
          keys.map((key) => ({
            id: IDS.get(key) ?? `id-${key}`,
            key,
            action: 'read',
            subject: 'Incident',
            accountType: key.startsWith('invoice') ? 'TREKLINK' : 'ORGANIZATION',
            conditions: null,
          })),
        ),
      ),
    };
    policies = {
      findStored: jest.fn().mockResolvedValue(NONE),
      findRoleByKey: jest.fn((key: string) => Promise.resolve({ id: `role-${key}`, key })),
      lockVersion: jest.fn().mockResolvedValue(0),
      replaceStored: jest.fn().mockResolvedValue(1),
    };
    events = {
      transaction: jest.fn((work: (t: unknown) => unknown) => work(tx)),
      emitAfterCommit: jest.fn(),
    };
    context = {
      forUser: jest
        .fn()
        .mockResolvedValue({ organizationId: 'org-a', organizationStatus: 'ACTIVE' }),
      lockOrganizationStatus: jest.fn().mockResolvedValue('ACTIVE'),
    };
    service = new OrganizationRolePolicyService(
      accounts as unknown as AccountsRepository,
      policies as unknown as OrganizationRolePolicyRepository,
      events as unknown as TransactionalEvents,
      context as never,
    );
  });

  const storedRows = (): unknown => (policies.replaceStored.mock.calls[0] as unknown[])[2];

  const replace = (
    roleKey: string,
    keys: string[],
    expectedVersion = 0,
    caller: Caller = MANAGER,
  ) => service.replace(caller, roleKey, keys, expectedVersion, CLIENT);

  describe('view (api-design 19)', () => {
    it('returns both roles with baseline, effective keys and version, and the ceiling as a catalog', async () => {
      policies.findStored.mockImplementation((_org: string, role: string) =>
        Promise.resolve(
          role === 'ORG_OPERATOR'
            ? { grants: [], revokes: ['incident.respond.own'], version: 2, updatedAt: null }
            : NONE,
        ),
      );

      const result = await service.view(MANAGER);

      expect(result.roles).toEqual([
        {
          key: 'ORG_MANAGER',
          version: 0,
          baselineKeys: MANAGER_ROWS.map((row) => row.key).sort(),
          effectiveKeys: MANAGER_ROWS.map((row) => row.key).sort(),
        },
        {
          key: 'ORG_OPERATOR',
          version: 2,
          baselineKeys: ['incident.read.own', 'incident.respond.own'],
          effectiveKeys: ['incident.read.own'],
        },
      ]);
      expect(result.catalog.map((row) => row.key)).toEqual(
        MANAGER_ROWS.map((row) => row.key).sort(),
      );
      expect(result.catalog.find((row) => row.key === 'organizationRole.manage.own')).toMatchObject(
        {
          scope: 'own',
          protected: true,
          accountType: 'ORGANIZATION',
        },
      );
      expect(policies.findStored).toHaveBeenCalledWith('org-a', 'ORG_MANAGER');
    });

    it('reads while the organization is not ACTIVE', async () => {
      context.forUser.mockResolvedValue({
        organizationId: 'org-a',
        organizationStatus: 'SUSPENDED',
      });
      await expect(service.view(MANAGER)).resolves.toHaveProperty('roles');
    });

    it('refuses an account with no membership with 403', async () => {
      context.forUser.mockResolvedValue(null);
      await expect(service.view(MANAGER)).rejects.toMatchObject({ errorCode: ErrorCode.FORBIDDEN });
    });
  });

  describe('viewOf (organizations api-design 33)', () => {
    it('reads the named organization without asking the caller membership', async () => {
      policies.findStored.mockImplementation((_org: string, role: string) =>
        Promise.resolve(
          role === 'ORG_OPERATOR'
            ? { grants: [], revokes: ['incident.respond.own'], version: 2, updatedAt: null }
            : NONE,
        ),
      );

      const result = await service.viewOf('org-z');

      expect(context.forUser).not.toHaveBeenCalled();
      expect(policies.findStored).toHaveBeenCalledWith('org-z', 'ORG_MANAGER');
      expect(policies.findStored).toHaveBeenCalledWith('org-z', 'ORG_OPERATOR');
      expect(result.roles.find((role) => role.key === 'ORG_OPERATOR')).toMatchObject({
        version: 2,
        effectiveKeys: ['incident.read.own'],
      });
      expect(result.catalog.length).toBeGreaterThan(0);
    });
  });

  describe('replace (api-design 20)', () => {
    it('stores the difference from the baseline as a revoke and counts the save (AC-07)', async () => {
      const saved = await replace('ORG_OPERATOR', ['incident.read.own']);

      expect(saved).toEqual({
        key: 'ORG_OPERATOR',
        version: 1,
        effectiveKeys: ['incident.read.own'],
      });
      expect(policies.replaceStored).toHaveBeenCalledWith(
        'org-a',
        'role-ORG_OPERATOR',
        [{ permissionId: 'id-incident.respond.own', effect: OrganizationRoleEffect.REVOKE }],
        'manager-a',
        tx,
      );
    });

    it('stores a grant inside the ceiling for the Operator', async () => {
      const saved = await replace('ORG_OPERATOR', [
        'incident.read.own',
        'incident.respond.own',
        'member.manage.own',
      ]);

      expect(saved.effectiveKeys).toContain('member.manage.own');
      expect(policies.replaceStored).toHaveBeenCalledWith(
        'org-a',
        'role-ORG_OPERATOR',
        [{ permissionId: 'id-member.manage.own', effect: OrganizationRoleEffect.GRANT }],
        'manager-a',
        tx,
      );
    });

    it('stores nothing for a list equal to the baseline, and still counts the save', async () => {
      await replace('ORG_OPERATOR', ['incident.read.own', 'incident.respond.own']);
      expect(storedRows()).toEqual([]);
    });

    it('keeps the Operator baseline in the Manager set whatever the list says (OQ-01)', async () => {
      const saved = await replace('ORG_MANAGER', ['organizationRole.manage.own']);

      expect(saved.effectiveKeys).toEqual([
        'incident.read.own',
        'incident.respond.own',
        'organizationRole.manage.own',
      ]);
      expect(storedRows()).toEqual([
        { permissionId: 'id-member.manage.own', effect: OrganizationRoleEffect.REVOKE },
      ]);
    });

    it('emits the organization change and the audit record after commit (REQ-EVT-10)', async () => {
      await replace('ORG_OPERATOR', ['incident.read.own']);

      expect(events.emitAfterCommit).toHaveBeenCalledWith(POLICY_CHANGED, {
        organizationId: 'org-a',
      });
      expect(events.emitAfterCommit).toHaveBeenCalledWith(
        AUDIT_RECORD,
        expect.objectContaining({
          action: 'organization.rolePermissions',
          organizationId: 'org-a',
          actorId: 'manager-a',
          subjectId: 'role-ORG_OPERATOR',
          ip: '10.0.0.1',
          after: expect.objectContaining({
            granted: [],
            revoked: ['incident.respond.own'],
            version: 1,
          }) as unknown,
        }),
      );
    });

    it('refuses an organization that is not ACTIVE with 409 and writes nothing (REQ-STA-04)', async () => {
      context.forUser.mockResolvedValue({
        organizationId: 'org-a',
        organizationStatus: 'SUSPENDED',
      });

      await expect(replace('ORG_OPERATOR', ['incident.read.own'])).rejects.toMatchObject({
        errorCode: ErrorCode.ORGANIZATION_NOT_ACTIVE,
        message: 'Role permissions cannot be changed while the organization is suspended.',
      });
      expect(events.transaction).not.toHaveBeenCalled();
    });

    it.each(['STAFF', 'ADMIN', 'nonsense'])('answers 404 for the role %s', async (roleKey) => {
      await expect(replace(roleKey, [])).rejects.toMatchObject({ errorCode: ErrorCode.NOT_FOUND });
      expect(events.transaction).not.toHaveBeenCalled();
    });

    it('refuses an unknown key with 400 UNKNOWN_PERMISSION', async () => {
      accounts.listPermissions.mockResolvedValueOnce([]);

      await expect(replace('ORG_OPERATOR', ['nothing.here'])).rejects.toMatchObject({
        errorCode: ErrorCode.UNKNOWN_PERMISSION,
        message: 'Unknown permission: nothing.here.',
      });
    });

    it('refuses a TrekLink permission as outside the ceiling', async () => {
      await expect(replace('ORG_OPERATOR', ['invoice.read'])).rejects.toMatchObject({
        errorCode: ErrorCode.PERMISSION_OUT_OF_CEILING,
        message: 'invoice.read cannot be granted to this role.',
      });
      expect(policies.lockVersion).not.toHaveBeenCalled();
    });

    it('refuses a Manager-protected permission for the Operator (OQ-06)', async () => {
      await expect(
        replace('ORG_OPERATOR', ['incident.read.own', 'organizationRole.manage.own']),
      ).rejects.toMatchObject({ errorCode: ErrorCode.PERMISSION_OUT_OF_CEILING });
    });

    it('refuses a Manager set without organizationRole.manage.own with 409 (AC-08)', async () => {
      await expect(replace('ORG_MANAGER', ['member.manage.own'])).rejects.toMatchObject({
        errorCode: ErrorCode.MANAGER_LOCKOUT,
        message: 'Managers must keep the right to manage roles.',
      });
      expect(policies.replaceStored).not.toHaveBeenCalled();
    });

    it('refuses a stale version with 409 STALE_VERSION and stores nothing', async () => {
      policies.lockVersion.mockResolvedValue(3);

      await expect(replace('ORG_OPERATOR', ['incident.read.own'], 2)).rejects.toMatchObject({
        errorCode: ErrorCode.STALE_VERSION,
      });
      expect(policies.replaceStored).not.toHaveBeenCalled();
      expect(events.emitAfterCommit).not.toHaveBeenCalled();
    });

    it('reads the organization status again under a lock inside the transaction (REQ-STA-04)', async () => {
      await replace('ORG_OPERATOR', ['incident.read.own']);

      expect(context.lockOrganizationStatus).toHaveBeenCalledWith('org-a', tx);
      // The lock comes before the policy row is touched.
      expect(context.lockOrganizationStatus.mock.invocationCallOrder[0]).toBeLessThan(
        policies.lockVersion.mock.invocationCallOrder[0],
      );
    });

    it('refuses a save when a suspension committed after the first status read, and writes nothing', async () => {
      // The read before the transaction saw ACTIVE; the locked read inside it sees SUSPENDED.
      context.lockOrganizationStatus.mockResolvedValue('SUSPENDED');

      await expect(replace('ORG_OPERATOR', ['incident.read.own'])).rejects.toMatchObject({
        errorCode: ErrorCode.ORGANIZATION_NOT_ACTIVE,
        message: 'Role permissions cannot be changed while the organization is suspended.',
      });
      expect(policies.lockVersion).not.toHaveBeenCalled();
      expect(policies.replaceStored).not.toHaveBeenCalled();
      expect(events.emitAfterCommit).not.toHaveBeenCalled();
    });

    it('answers 404 when the organization is gone under the lock', async () => {
      context.lockOrganizationStatus.mockResolvedValue(null);

      await expect(replace('ORG_OPERATOR', ['incident.read.own'])).rejects.toMatchObject({
        errorCode: ErrorCode.NOT_FOUND,
        message: 'Organization not found.',
      });
    });

    it('takes the organization of the caller, never one from the request (REQ-UBI-06)', async () => {
      context.forUser.mockResolvedValue({ organizationId: 'org-b', organizationStatus: 'ACTIVE' });

      await replace('ORG_OPERATOR', ['incident.read.own']);

      expect(policies.lockVersion).toHaveBeenCalledWith('org-b', 'role-ORG_OPERATOR', tx);
    });
  });
});
