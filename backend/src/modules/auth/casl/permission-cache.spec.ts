import { ParameterService } from '../../platform/parameters/parameter.service';
import { AccountsRepository, PermissionRuleRow } from '../accounts.repository';
import { OrganizationRolePolicyRepository } from '../organization-role-policy.repository';
import { PermissionCache } from './permission-cache';

const rule = (key: string, subject: string): PermissionRuleRow => ({
  key,
  action: 'read',
  subject,
  conditions: null,
  fields: [],
  inverted: false,
  reason: null,
});

const NONE = { grants: [], revokes: [], version: 0, updatedAt: null };

const ROWS: Record<string, PermissionRuleRow[]> = {
  STAFF: [rule('incident.read', 'Incident')],
  ADMIN: [rule('parameter.update', 'BusinessParameter')],
  ORG_OPERATOR: [rule('incident.read.own', 'Incident')],
  ORG_MANAGER: [rule('member.manage.own', 'Member')],
};

describe('PermissionCache', () => {
  let accounts: { findRolePermissions: jest.Mock; findPermissionRules: jest.Mock };
  let policies: { findStored: jest.Mock };
  let parameters: { get: jest.Mock };
  let cache: PermissionCache;

  beforeEach(() => {
    accounts = {
      findRolePermissions: jest.fn((key: string) => Promise.resolve(ROWS[key] ?? [])),
      findPermissionRules: jest.fn((keys: string[]) =>
        Promise.resolve(keys.map((key) => rule(key, 'LiveMap'))),
      ),
    };
    policies = { findStored: jest.fn().mockResolvedValue(NONE) };
    parameters = { get: jest.fn().mockResolvedValue(30) };
    cache = new PermissionCache(
      accounts as unknown as AccountsRepository,
      policies as unknown as OrganizationRolePolicyRepository,
      parameters as unknown as ParameterService,
    );
  });

  it.each([
    ['ADMIN', 'STAFF', ['parameter.update', 'incident.read']],
    ['ORG_MANAGER', 'ORG_OPERATOR', ['member.manage.own', 'incident.read.own']],
  ])('%s holds every permission of %s (FR-AUTH-10)', async (role, _inherited, keys) => {
    const rows = await cache.rulesFor([role]);
    expect(rows.map((row) => row.key)).toEqual(keys);
  });

  it('reads each role once, even when two roles share an inherited one', async () => {
    await cache.rulesFor(['ADMIN', 'STAFF']);
    await cache.rulesFor(['STAFF']);

    expect(accounts.findRolePermissions.mock.calls).toEqual([['ADMIN'], ['STAFF']]);
  });

  it('grants nothing for an unknown role', async () => {
    await expect(cache.rulesFor(['GUEST'])).resolves.toEqual([]);
  });

  it('reads again after policy.changed and counts the version (REQ-EVT-08, AC-03)', async () => {
    expect(cache.version).toBe(0);
    await cache.rulesFor(['STAFF']);

    cache.invalidate();
    ROWS.STAFF = [];
    await expect(cache.rulesFor(['STAFF'])).resolves.toEqual([]);

    expect(cache.version).toBe(1);
    expect(accounts.findRolePermissions).toHaveBeenCalledTimes(2);
    ROWS.STAFF = [rule('incident.read', 'Incident')];
  });

  describe('rulesForKeys (auth task 4.3)', () => {
    it('reads a key set once, whatever its order, and again after policy.changed', async () => {
      await cache.rulesForKeys(['b.read.own', 'a.read.own']);
      await expect(cache.rulesForKeys(['a.read.own', 'b.read.own'])).resolves.toHaveLength(2);
      expect(accounts.findPermissionRules).toHaveBeenCalledTimes(1);

      cache.invalidate();
      await cache.rulesForKeys(['a.read.own', 'b.read.own']);
      expect(accounts.findPermissionRules).toHaveBeenCalledTimes(2);
    });

    it('does not keep a failed read', async () => {
      accounts.findPermissionRules.mockRejectedValueOnce(new Error('database down'));

      await expect(cache.rulesForKeys(['a.read.own'])).rejects.toThrow('database down');
      await expect(cache.rulesForKeys(['a.read.own'])).resolves.toHaveLength(1);
    });
  });

  it('does not keep a failed read', async () => {
    accounts.findRolePermissions.mockRejectedValueOnce(new Error('database down'));

    await expect(cache.rulesFor(['STAFF'])).rejects.toThrow('database down');
    await expect(cache.rulesFor(['STAFF'])).resolves.toHaveLength(1);
    expect(accounts.findRolePermissions).toHaveBeenCalledTimes(2);
  });

  describe('organization roles (D-095, design 9.3 and 9.4)', () => {
    const OPERATOR_ROWS = [
      rule('incident.read.own', 'Incident'),
      rule('incident.respond.own', 'Incident'),
    ];
    const MANAGER_ROWS = [
      ...OPERATOR_ROWS,
      rule('member.manage.own', 'Member'),
      rule('organizationRole.manage.own', 'OrganizationRole'),
    ];
    const keysOf = async (roles: string[], organizationId: string | null) =>
      (await cache.rulesFor(roles, organizationId)).map((row) => row.key).sort();

    beforeEach(() => {
      ROWS.ORG_OPERATOR = OPERATOR_ROWS;
      ROWS.ORG_MANAGER = MANAGER_ROWS;
    });

    it('gives a member the baseline when the organization stored nothing', async () => {
      await expect(keysOf(['ORG_OPERATOR'], 'org-a')).resolves.toEqual([
        'incident.read.own',
        'incident.respond.own',
      ]);
      await expect(keysOf(['ORG_MANAGER'], 'org-a')).resolves.toHaveLength(4);
    });

    it('applies the stored revoke to the Operator of that organization only', async () => {
      policies.findStored.mockImplementation((organizationId: string, role: string) =>
        Promise.resolve(
          organizationId === 'org-a' && role === 'ORG_OPERATOR'
            ? { grants: [], revokes: ['incident.respond.own'], version: 1, updatedAt: null }
            : NONE,
        ),
      );

      await expect(keysOf(['ORG_OPERATOR'], 'org-a')).resolves.toEqual(['incident.read.own']);
      await expect(keysOf(['ORG_OPERATOR'], 'org-b')).resolves.toHaveLength(2);
      await expect(keysOf(['ORG_MANAGER'], 'org-a')).resolves.toContain('incident.respond.own');
    });

    it('reads the baselines once for every organization', async () => {
      await keysOf(['ORG_OPERATOR'], 'org-a');
      await keysOf(['ORG_OPERATOR'], 'org-b');

      expect(accounts.findRolePermissions.mock.calls.map(([key]: [string]) => key).sort()).toEqual([
        'ORG_MANAGER',
        'ORG_OPERATOR',
      ]);
      expect(policies.findStored).toHaveBeenCalledTimes(2);
    });

    it('keeps the baseline rows for an organization role without an organization', async () => {
      await expect(keysOf(['ORG_OPERATOR'], null)).resolves.toHaveLength(2);
      expect(policies.findStored).not.toHaveBeenCalled();
    });

    it('drops only the entries of one organization and leaves the version alone', async () => {
      await keysOf(['ORG_OPERATOR'], 'org-a');
      await keysOf(['ORG_OPERATOR'], 'org-b');
      policies.findStored.mockClear();

      cache.invalidate({ organizationId: 'org-a' });
      await keysOf(['ORG_OPERATOR'], 'org-a');
      await keysOf(['ORG_OPERATOR'], 'org-b');

      expect(cache.version).toBe(0);
      expect(policies.findStored).toHaveBeenCalledTimes(1);
      expect(policies.findStored).toHaveBeenCalledWith('org-a', 'ORG_OPERATOR');
    });

    it('drops every organization and counts the version for an Admin change', async () => {
      await keysOf(['ORG_OPERATOR'], 'org-a');
      policies.findStored.mockClear();

      cache.invalidate({ roleId: 'role-1' });
      await keysOf(['ORG_OPERATOR'], 'org-a');

      expect(cache.version).toBe(1);
      expect(policies.findStored).toHaveBeenCalledTimes(1);
    });

    it('does not keep a failed read of an organization', async () => {
      policies.findStored.mockRejectedValueOnce(new Error('database down'));

      await expect(keysOf(['ORG_OPERATOR'], 'org-a')).rejects.toThrow('database down');
      await expect(keysOf(['ORG_OPERATOR'], 'org-a')).resolves.toHaveLength(2);
    });
  });

  describe('time-to-live (auth.permissionCacheTtlSeconds, REQ-EVT-08)', () => {
    afterEach(() => jest.restoreAllMocks());

    it.each([
      ['a role', () => cache.rulesFor(['STAFF']), () => accounts.findRolePermissions],
      [
        'an organization role',
        () => cache.rulesFor(['ORG_OPERATOR'], 'org-a'),
        () => policies.findStored,
      ],
      ['a key set', () => cache.rulesForKeys(['a.read.own']), () => accounts.findPermissionRules],
    ])('reads %s again once the time-to-live has passed', async (_name, read, reads) => {
      let now = 1_000_000;
      jest.spyOn(Date, 'now').mockImplementation(() => now);

      await read();
      now += 29_000;
      await read();
      expect(reads()).toHaveBeenCalledTimes(1);

      now += 2_000;
      await read();
      expect(reads()).toHaveBeenCalledTimes(2);
    });

    it('uses 30 seconds when the parameter cannot be read', async () => {
      parameters.get.mockRejectedValue(new Error('database down'));
      let now = 0;
      jest.spyOn(Date, 'now').mockImplementation(() => now);

      await cache.rulesFor(['STAFF']);
      now += 31_000;
      await cache.rulesFor(['STAFF']);

      expect(accounts.findRolePermissions).toHaveBeenCalledTimes(2);
    });
  });
});
