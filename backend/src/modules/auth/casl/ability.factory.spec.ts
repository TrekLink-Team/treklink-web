import { subject } from '@casl/ability';
import { AccountsRepository, PermissionRuleRow } from '../accounts.repository';
import { AbilityContext, AbilityFactory, interpolate, toRule } from './ability.factory';
import { PermissionCache } from './permission-cache';

const row = (overrides: Partial<PermissionRuleRow> = {}): PermissionRuleRow => ({
  key: 'incident.read.own',
  action: 'read',
  subject: 'Incident',
  conditions: { organizationId: '${user.organizationId}' },
  fields: [],
  inverted: false,
  reason: null,
  ...overrides,
});

// A row of a subject type, as a service checks it after loading.
const record = (type: string, fields: Record<string, unknown>) => subject(type, fields);

const MEMBER: AbilityContext = {
  userId: 'user-1',
  organizationId: 'org-a',
  roles: ['ORG_OPERATOR'],
};

describe('interpolate', () => {
  it('fills ${user.id} and ${user.organizationId} from the context', () => {
    expect(
      interpolate(
        {
          organizationId: '${user.organizationId}',
          createdById: '${user.id}',
          status: { $in: ['OPEN', '${user.id}'] },
          priority: 2,
          note: 'see ${user.organizationId} later',
        },
        MEMBER,
      ),
    ).toEqual({
      organizationId: 'org-a',
      createdById: 'user-1',
      status: { $in: ['OPEN', 'user-1'] },
      priority: 2,
      note: 'see ${user.organizationId} later',
    });
  });

  it('turns a placeholder the context cannot fill into null', () => {
    expect(
      interpolate(
        { organizationId: '${user.organizationId}' },
        { userId: 's', organizationId: null, roles: [] },
      ),
    ).toEqual({ organizationId: null });
  });

  it('leaves null as it is', () => {
    expect(interpolate(null, MEMBER)).toBeNull();
  });
});

describe('toRule', () => {
  it('carries conditions, fields, inverted and reason only when set', () => {
    expect(toRule(row(), MEMBER)).toEqual({
      action: 'read',
      subject: 'Incident',
      conditions: { organizationId: 'org-a' },
    });
    expect(
      toRule(
        row({ conditions: null, fields: ['note'], inverted: true, reason: 'Closed incidents.' }),
        MEMBER,
      ),
    ).toEqual({
      action: 'read',
      subject: 'Incident',
      fields: ['note'],
      inverted: true,
      reason: 'Closed incidents.',
    });
  });
});

describe('AbilityFactory', () => {
  const ROWS: Record<string, PermissionRuleRow[]> = {
    STAFF: [row({ key: 'incident.read', conditions: null })],
    ADMIN: [
      row({
        key: 'parameter.update',
        action: 'update',
        subject: 'BusinessParameter',
        conditions: null,
      }),
    ],
    ORG_OPERATOR: [row()],
    ORG_MANAGER: [
      row({
        key: 'member.manage.own',
        action: 'manage',
        subject: 'Member',
        conditions: { organizationId: '${user.organizationId}' },
      }),
    ],
  };
  let factory: AbilityFactory;
  let cache: PermissionCache;

  beforeEach(() => {
    const accounts = {
      findRolePermissions: jest.fn((key: string) => Promise.resolve(ROWS[key] ?? [])),
    };
    cache = new PermissionCache(accounts as unknown as AccountsRepository);
    factory = new AbilityFactory(cache);
  });

  it('limits an `own` permission to the organization of the context (FR-AUTH-11)', async () => {
    const ability = await factory.forContext(MEMBER);

    expect(ability.can('read', record('Incident', { organizationId: 'org-a' }))).toBe(true);
    expect(ability.can('read', record('Incident', { organizationId: 'org-b' }))).toBe(false);
    expect(ability.can('read', 'Incident')).toBe(true);
    expect(ability.can('read', 'Member')).toBe(false);
  });

  it('cannot be widened by an organizationId the request carries (REQ-UBI-06)', async () => {
    const body = { organizationId: 'org-b' };
    const ability = await factory.forContext(MEMBER);

    // The record a member submits for another organization is refused, whatever the body says.
    expect(ability.can('read', record('Incident', { ...body }))).toBe(false);
    expect(ability.rulesFor('read', 'Incident')[0].conditions).toEqual({ organizationId: 'org-a' });
  });

  it('gives an Org Manager the Org Operator permissions too (FR-AUTH-10)', async () => {
    const ability = await factory.forContext({ ...MEMBER, roles: ['ORG_MANAGER'] });

    expect(ability.can('manage', record('Member', { organizationId: 'org-a' }))).toBe(true);
    expect(ability.can('read', record('Incident', { organizationId: 'org-a' }))).toBe(true);
  });

  it('gives an Admin the Staff permissions too, across organizations', async () => {
    const ability = await factory.forContext({
      userId: 'admin-1',
      organizationId: null,
      roles: ['ADMIN'],
    });

    expect(ability.can('update', 'BusinessParameter')).toBe(true);
    expect(ability.can('read', record('Incident', { organizationId: 'org-b' }))).toBe(true);
  });

  it('applies a removed permission on the next request after policy.changed (AC-03)', async () => {
    expect((await factory.forContext(MEMBER)).can('read', 'Incident')).toBe(true);

    const granted = ROWS.ORG_OPERATOR;
    ROWS.ORG_OPERATOR = [];
    cache.invalidate();

    expect((await factory.forContext(MEMBER)).can('read', 'Incident')).toBe(false);
    ROWS.ORG_OPERATOR = granted;
  });
});
