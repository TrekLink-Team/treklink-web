import { describe, expect, it } from 'vitest';
import type { Permission, Role } from './api';
import {
  catalogFor,
  cellOf,
  changeSummary,
  changedRoles,
  confirmTitle,
  diffOf,
  diffSentence,
  groupBySubject,
  isChanged,
  isDirty,
  keysOf,
  roleTitle,
  scopeText,
  sortRoles,
  toggled,
} from './model';

const permission = (overrides: Partial<Permission> = {}): Permission => ({
  key: 'liveMap.read.own',
  action: 'read',
  subject: 'LiveMap',
  scope: 'own',
  accountType: 'ORGANIZATION',
  description: 'Read the live map',
  protected: false,
  ...overrides,
});

const role = (overrides: Partial<Role> = {}): Role => ({
  id: 'r-1',
  key: 'ORG_OPERATOR',
  accountType: 'ORGANIZATION',
  isSystem: true,
  permissionKeys: [],
  ...overrides,
});

describe('the role model (screen 7.2)', () => {
  it('lists only the permissions of the role account type', () => {
    const catalog = [
      permission(),
      permission({ key: 'role.manage', accountType: 'TREKLINK', subject: 'Role' }),
    ];
    expect(catalogFor(role(), catalog).map((item) => item.key)).toEqual(['liveMap.read.own']);
    expect(catalogFor(role({ accountType: 'TREKLINK' }), catalog).map((item) => item.key)).toEqual([
      'role.manage',
    ]);
  });

  it('groups by subject in a stable order', () => {
    const groups = groupBySubject([
      permission({ key: 'b.read', subject: 'Zeta' }),
      permission({ key: 'a.read', subject: 'Alpha' }),
      permission({ key: 'a.edit', subject: 'Alpha' }),
    ]);
    expect(groups.map(([subject, list]) => [subject, list.map((item) => item.key)])).toEqual([
      ['Alpha', ['a.edit', 'a.read']],
      ['Zeta', ['b.read']],
    ]);
  });

  it('words the scope', () => {
    expect(scopeText(permission())).toBe('Own organization only');
    expect(scopeText(permission({ scope: 'any' }))).toBe('Any organization');
  });

  it('diffs a draft against what is saved', () => {
    const diff = diffOf(['a', 'b', 'c'], new Set(['b', 'c', 'd', 'e']));
    expect(diff).toEqual({ added: ['d', 'e'], removed: ['a'] });
    expect(isDirty(diff)).toBe(true);
    expect(isDirty(diffOf(['a'], new Set(['a'])))).toBe(false);
  });

  it('words the change with only the parts that apply', () => {
    expect(diffSentence('ORG_OPERATOR', { added: ['x', 'y'], removed: ['z'] })).toBe(
      'Change ORG_OPERATOR: remove 1, add 2?',
    );
    expect(diffSentence('STAFF', { added: ['x'], removed: [] })).toBe('Change STAFF: add 1?');
    expect(diffSentence('STAFF', { added: [], removed: ['x', 'y'] })).toBe(
      'Change STAFF: remove 2?',
    );
  });

  it('turns a role key into a name', () => {
    expect(roleTitle('ORG_OPERATOR')).toBe('Org Operator');
  });
});

describe('grid model (screen 7.2)', () => {
  const admin = role({ id: 'r-admin', key: 'ADMIN', accountType: 'TREKLINK', permissionKeys: ['role.manage'] });
  const staff = role({ id: 'r-staff', key: 'STAFF', accountType: 'TREKLINK', permissionKeys: [] });
  const manager = role({ id: 'r-mgr', key: 'ORG_MANAGER', permissionKeys: [] });
  const operator = role({ id: 'r-op', key: 'ORG_OPERATOR', permissionKeys: ['liveMap.read.own'] });
  const roles = [operator, staff, manager, admin];
  const platform = permission({ key: 'account.manage', accountType: 'TREKLINK', scope: 'any' });
  const protectedKey = permission({ key: 'role.manage', accountType: 'TREKLINK', protected: true });

  it('orders the columns ADMIN, STAFF, ORG_MANAGER, ORG_OPERATOR and puts an unknown role last', () => {
    const extra = role({ id: 'r-x', key: 'AUDITOR' });
    expect(sortRoles([extra, ...roles]).map((item) => item.key)).toEqual([
      'ADMIN',
      'STAFF',
      'ORG_MANAGER',
      'ORG_OPERATOR',
      'AUDITOR',
    ]);
  });

  it('toggles one key in the draft of one role and leaves the others alone', () => {
    const drafts = toggled(operator, 'incident.read.own', {});
    expect([...keysOf(operator, drafts)].sort()).toEqual(['incident.read.own', 'liveMap.read.own']);
    expect([...keysOf(manager, drafts)]).toEqual([]);
    const back = toggled(operator, 'incident.read.own', drafts);
    expect(changedRoles(roles, back)).toEqual([]);
  });

  it('marks a cell that differs from the saved set, in either direction', () => {
    const drafts = toggled(operator, 'liveMap.read.own', toggled(operator, 'incident.read.own', {}));
    expect(isChanged(operator, 'incident.read.own', drafts)).toBe(true);
    expect(isChanged(operator, 'liveMap.read.own', drafts)).toBe(true);
    expect(isChanged(operator, 'other.read.own', drafts)).toBe(false);
  });

  it('lists the changed roles in column order and counts the changes', () => {
    const drafts = toggled(operator, 'liveMap.read.own', toggled(staff, 'account.manage', {}));
    const changed = changedRoles(sortRoles(roles), drafts);
    expect(changed.map(({ role: item }) => item.key)).toEqual(['STAFF', 'ORG_OPERATOR']);
    expect(changeSummary(changed)).toBe('2 changes in 2 roles');
    expect(changeSummary(changed.slice(0, 1))).toBe('1 change in 1 role');
    expect(changeSummary([])).toBe('No changes');
  });

  it('titles the confirmation with the one role, or with the count of roles', () => {
    const one = changedRoles(roles, toggled(operator, 'liveMap.read.own', {}));
    expect(confirmTitle(one)).toBe('Change ORG_OPERATOR: remove 1?');
    const two = changedRoles(roles, toggled(staff, 'account.manage', toggled(operator, 'liveMap.read.own', {})));
    expect(confirmTitle(two)).toBe('Change 2 roles?');
  });

  it('gives no box to a permission of the other account type', () => {
    expect(cellOf(platform, operator, roles, {})).toEqual({ kind: 'unavailable' });
    expect(cellOf(permission(), admin, roles, {})).toEqual({ kind: 'unavailable' });
  });

  it('locks a protected permission on ADMIN only', () => {
    expect(cellOf(protectedKey, admin, roles, {})).toEqual({ kind: 'locked' });
    expect(cellOf(protectedKey, staff, roles, {})).toEqual({ kind: 'editable', checked: false });
  });

  it('shows a permission of the lower role as inherited, following that role draft', () => {
    expect(cellOf(permission(), manager, roles, {})).toEqual({
      kind: 'inherited',
      from: 'ORG_OPERATOR',
    });
    const without = toggled(operator, 'liveMap.read.own', {});
    expect(cellOf(permission(), manager, roles, without)).toEqual({ kind: 'editable', checked: false });
    const staffHolds = toggled(staff, 'account.manage', {});
    expect(cellOf(platform, admin, roles, staffHolds)).toEqual({ kind: 'inherited', from: 'STAFF' });
  });
});
