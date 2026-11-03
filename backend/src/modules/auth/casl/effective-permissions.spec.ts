import { Baselines, effectiveKeys, isOrganizationRole, NO_DELTA } from './effective-permissions';

const MANAGER_ONLY = ['member.manage.own', 'organizationRole.manage.own'];
const OPERATOR = ['incident.read.own', 'incident.respond.own'];

// The baseline of ORG_MANAGER holds every row of ORG_OPERATOR (FR-AUTH-10).
const baselines: Baselines = {
  manager: new Set([...OPERATOR, ...MANAGER_ONLY]),
  operator: new Set(OPERATOR),
};
const sorted = (keys: Set<string>) => [...keys].sort();

describe('effectiveKeys (specs/auth/design.md §9.3)', () => {
  it('is the baseline when the organization stored nothing', () => {
    expect(sorted(effectiveKeys('ORG_OPERATOR', baselines, NO_DELTA))).toEqual(OPERATOR);
    expect(sorted(effectiveKeys('ORG_MANAGER', baselines, NO_DELTA))).toEqual(
      [...OPERATOR, ...MANAGER_ONLY].sort(),
    );
  });

  it('adds a grant inside the ceiling to the Operator', () => {
    const keys = effectiveKeys('ORG_OPERATOR', baselines, {
      grants: ['member.manage.own'],
      revokes: [],
    });
    expect(sorted(keys)).toEqual([...OPERATOR, 'member.manage.own'].sort());
  });

  it('removes a revoked permission from the Operator', () => {
    const keys = effectiveKeys('ORG_OPERATOR', baselines, {
      grants: [],
      revokes: ['incident.respond.own'],
    });
    expect(sorted(keys)).toEqual(['incident.read.own']);
  });

  it('ignores a grant outside the ceiling, as when the Admin narrowed the Manager baseline (AC-09)', () => {
    const keys = effectiveKeys('ORG_OPERATOR', baselines, {
      grants: ['invoice.read.own'],
      revokes: [],
    });
    expect(sorted(keys)).toEqual(OPERATOR);
  });

  it('ignores a revoke of a permission the baseline no longer holds', () => {
    const keys = effectiveKeys('ORG_OPERATOR', baselines, {
      grants: [],
      revokes: ['invoice.read.own'],
    });
    expect(sorted(keys)).toEqual(OPERATOR);
  });

  it('does not let an Operator revoke reach the Manager (OQ-01, AC-10)', () => {
    const operator = effectiveKeys('ORG_OPERATOR', baselines, {
      grants: [],
      revokes: ['incident.respond.own'],
    });
    const manager = effectiveKeys('ORG_MANAGER', baselines, NO_DELTA);

    expect(operator.has('incident.respond.own')).toBe(false);
    expect(manager.has('incident.respond.own')).toBe(true);
  });

  it('gives the Manager nothing outside its own baseline and the Operator baseline', () => {
    const manager = effectiveKeys('ORG_MANAGER', baselines, NO_DELTA);
    expect(manager.has('invoice.read.own')).toBe(false);
  });

  it('lets the Manager narrow its own permissions, but not those of the Operator baseline', () => {
    const keys = effectiveKeys('ORG_MANAGER', baselines, {
      grants: [],
      revokes: ['member.manage.own', 'incident.read.own'],
    });
    expect(keys.has('member.manage.own')).toBe(false);
    expect(keys.has('incident.read.own')).toBe(true);
  });

  it('always keeps the protected permission of the Manager (REQ-UBI-12)', () => {
    const keys = effectiveKeys('ORG_MANAGER', baselines, {
      grants: [],
      revokes: ['organizationRole.manage.own'],
    });
    expect(keys.has('organizationRole.manage.own')).toBe(true);
  });

  it('keeps the Manager protected permission even when the baseline row is missing', () => {
    const keys = effectiveKeys(
      'ORG_MANAGER',
      { manager: new Set(['member.manage.own']), operator: new Set() },
      NO_DELTA,
    );
    expect(keys.has('organizationRole.manage.own')).toBe(true);
  });

  it('tells an organization role from any other', () => {
    expect(isOrganizationRole('ORG_OPERATOR')).toBe(true);
    expect(isOrganizationRole('STAFF')).toBe(false);
  });
});
