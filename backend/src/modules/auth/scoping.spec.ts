import { createMongoAbility } from '@casl/ability';
import { ErrorCode } from '../../common/errors';
import { AppAbility } from './casl/ability.factory';
import { assertOwnOr404, scopeWhere } from './scoping';

const MEMBER_ORG = {
  id: 'org-a',
  code: 'ORG-0001',
  legalName: 'ACME Trek Co., Ltd.',
  status: 'ACTIVE',
  memberRole: 'OPERATOR' as const,
};

describe('scopeWhere', () => {
  it('does not filter a TrekLink account (BR-19)', () => {
    expect(scopeWhere({ accountType: 'TREKLINK', organization: null })).toEqual({});
  });

  it("filters a member to the caller's organization (FR-AUTH-11)", () => {
    expect(scopeWhere({ accountType: 'ORGANIZATION', organization: MEMBER_ORG })).toEqual({
      organizationId: 'org-a',
    });
  });

  it('refuses a member with no organization rather than return everything', () => {
    expect(() => scopeWhere({ accountType: 'ORGANIZATION', organization: null })).toThrow(
      expect.objectContaining({ errorCode: ErrorCode.FORBIDDEN }) as Error,
    );
  });
});

describe('assertOwnOr404', () => {
  const member = createMongoAbility<AppAbility>([
    { action: 'read', subject: 'Incident', conditions: { organizationId: 'org-a' } },
  ]);

  it("passes for a row of the caller's organization", () => {
    expect(() =>
      assertOwnOr404(member, 'read', 'Incident', { id: 'i-1', organizationId: 'org-a' }),
    ).not.toThrow();
  });

  it("answers 404 for another organization's row, as if it did not exist (REQ-ERR-06, AC-01)", () => {
    expect(() =>
      assertOwnOr404(member, 'read', 'Incident', { id: 'i-2', organizationId: 'org-b' }),
    ).toThrow(
      expect.objectContaining({
        errorCode: ErrorCode.NOT_FOUND,
        message: 'Incident not found.',
      }) as Error,
    );
    expect(() =>
      assertOwnOr404(member, 'read', 'Incident', { organizationId: 'org-b' }, 'No such incident.'),
    ).toThrow(expect.objectContaining({ message: 'No such incident.' }) as Error);
  });

  it('answers 403 when the caller may not read the subject at all', () => {
    expect(() =>
      assertOwnOr404(member, 'read', 'Member', { id: 'm-1', organizationId: 'org-a' }),
    ).toThrow(expect.objectContaining({ errorCode: ErrorCode.FORBIDDEN }) as Error);
  });

  it('does not tag the loaded row with a subject type', () => {
    const row = { id: 'i-1', organizationId: 'org-a' };
    assertOwnOr404(member, 'read', 'Incident', row);
    expect(Object.keys(row)).toEqual(['id', 'organizationId']);
  });
});
