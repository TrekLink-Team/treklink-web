import { describe, expect, it } from 'vitest';
import { effectiveRoles, hasAnyRole } from './permissions';

describe('hasAnyRole', () => {
  it('lets an Admin use Staff routes and a Manager use Operator routes', () => {
    expect(hasAnyRole(['ADMIN'], ['STAFF'])).toBe(true);
    expect(hasAnyRole(['ORG_MANAGER'], ['ORG_OPERATOR'])).toBe(true);
  });

  it('keeps an Operator out of Manager routes and organizations out of TrekLink routes (AC-01)', () => {
    expect(hasAnyRole(['ORG_OPERATOR'], ['ORG_MANAGER'])).toBe(false);
    expect(hasAnyRole(['ORG_MANAGER'], ['STAFF'])).toBe(false);
    expect(hasAnyRole(['STAFF'], ['ADMIN'])).toBe(false);
  });

  it('ignores unknown roles', () => {
    expect(hasAnyRole(['GUEST'], ['STAFF', 'ORG_OPERATOR'])).toBe(false);
    expect(effectiveRoles(['toString', 'constructor']).size).toBe(0);
  });
});
