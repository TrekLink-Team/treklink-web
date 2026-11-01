import { describe, expect, it } from 'vitest';
import type { Permission, Role } from './api';
import {
  catalogFor,
  diffOf,
  diffSentence,
  groupBySubject,
  isDirty,
  roleTitle,
  scopeText,
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
