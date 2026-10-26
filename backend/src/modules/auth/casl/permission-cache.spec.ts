import { AccountsRepository, PermissionRuleRow } from '../accounts.repository';
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

const ROWS: Record<string, PermissionRuleRow[]> = {
  STAFF: [rule('incident.read', 'Incident')],
  ADMIN: [rule('parameter.update', 'BusinessParameter')],
  ORG_OPERATOR: [rule('incident.read.own', 'Incident')],
  ORG_MANAGER: [rule('member.manage.own', 'Member')],
};

describe('PermissionCache', () => {
  let accounts: { findRolePermissions: jest.Mock; findPermissionRules: jest.Mock };
  let cache: PermissionCache;

  beforeEach(() => {
    accounts = {
      findRolePermissions: jest.fn((key: string) => Promise.resolve(ROWS[key] ?? [])),
      findPermissionRules: jest.fn((keys: string[]) =>
        Promise.resolve(keys.map((key) => rule(key, 'LiveMap'))),
      ),
    };
    cache = new PermissionCache(accounts as unknown as AccountsRepository);
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
});
