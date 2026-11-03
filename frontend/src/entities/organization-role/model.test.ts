import { describe, expect, it } from 'vitest';
import type { OrganizationRoles } from './api';
import {
  canReset,
  isCustomised,
  organizationCellOf,
  resetDraft,
  toGridCatalog,
  toGridRoles,
  versionOf,
} from './model';

const READ = 'incident.read.own';
const RESPOND = 'incident.respond.own';
const MEMBER = 'member.manage.own';
const ROLE = 'organizationRole.manage.own';

const permission = (key: string, isProtected = false) => ({
  key,
  action: 'read',
  subject: 'Incident',
  scope: 'own' as const,
  accountType: 'ORGANIZATION' as const,
  description: null,
  protected: isProtected,
});

const view: OrganizationRoles = {
  roles: [
    {
      key: 'ORG_MANAGER',
      version: 2,
      baselineKeys: [READ, RESPOND, MEMBER, ROLE],
      effectiveKeys: [READ, RESPOND, MEMBER, ROLE],
    },
    { key: 'ORG_OPERATOR', version: 1, baselineKeys: [READ, RESPOND], effectiveKeys: [READ] },
  ],
  catalog: [permission(READ), permission(RESPOND), permission(MEMBER), permission(ROLE, true)],
};
const roles = toGridRoles(view);
const catalog = toGridCatalog(view.catalog);
const [manager, operator] = roles;
const of = (key: string) => catalog.find((item) => item.key === key)!;

describe('organization role model (screen 3.7)', () => {
  it('shows the roles as system organization roles with their effective keys as the saved set', () => {
    expect(roles.map((role) => [role.id, role.accountType, role.isSystem])).toEqual([
      ['ORG_MANAGER', 'ORGANIZATION', true],
      ['ORG_OPERATOR', 'ORGANIZATION', true],
    ]);
    expect(operator.permissionKeys).toEqual([READ]);
    expect(of(READ).description).toBe('');
  });

  it('locks the protected permission on the Manager and removes it for the Operator', () => {
    expect(organizationCellOf(of(ROLE), manager, view, {})).toEqual({ kind: 'locked' });
    expect(organizationCellOf(of(ROLE), operator, view, {})).toEqual({ kind: 'unavailable' });
  });

  it('shows the Operator baseline on the Manager as inherited, whatever the Operator draft holds', () => {
    const draft = { ORG_OPERATOR: new Set<string>() };
    expect(organizationCellOf(of(RESPOND), manager, view, draft)).toEqual({
      kind: 'inherited',
      from: 'ORG_OPERATOR',
    });
  });

  it('gives a box to the rest, ticked from the draft or the saved set', () => {
    expect(organizationCellOf(of(MEMBER), manager, view, {})).toEqual({
      kind: 'editable',
      checked: true,
    });
    expect(organizationCellOf(of(RESPOND), operator, view, {})).toEqual({
      kind: 'editable',
      checked: false,
    });
    expect(
      organizationCellOf(of(RESPOND), operator, view, { ORG_OPERATOR: new Set([READ, RESPOND]) }),
    ).toEqual({ kind: 'editable', checked: true });
  });

  it('calls a cell customised when the saved set differs from the baseline', () => {
    expect(isCustomised(view, 'ORG_OPERATOR', RESPOND)).toBe(true);
    expect(isCustomised(view, 'ORG_OPERATOR', READ)).toBe(false);
    expect(isCustomised(view, 'ORG_MANAGER', MEMBER)).toBe(false);
    expect(isCustomised(view, 'NOPE', READ)).toBe(false);
  });

  it('resets the draft of one role to its baseline and leaves the others', () => {
    const drafts = { ORG_MANAGER: new Set([ROLE]) };
    const next = resetDraft(view, 'ORG_OPERATOR', drafts);
    expect([...next.ORG_OPERATOR].sort()).toEqual([READ, RESPOND]);
    expect(next.ORG_MANAGER).toBe(drafts.ORG_MANAGER);
  });

  it('allows a reset only when the shown set differs from the baseline', () => {
    expect(canReset(view, 'ORG_OPERATOR', {})).toBe(true);
    expect(canReset(view, 'ORG_OPERATOR', { ORG_OPERATOR: new Set([READ, RESPOND]) })).toBe(false);
    expect(canReset(view, 'ORG_MANAGER', {})).toBe(false);
    expect(canReset(view, 'NOPE', {})).toBe(false);
  });

  it('reads the version of each role, 0 for an unknown one', () => {
    expect(versionOf(view, 'ORG_MANAGER')).toBe(2);
    expect(versionOf(view, 'ORG_OPERATOR')).toBe(1);
    expect(versionOf(view, 'NOPE')).toBe(0);
  });
});
