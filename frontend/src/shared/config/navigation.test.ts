import { describe, expect, it } from 'vitest';
import { ALL_NAV, entryForPath, isFullBleed, tabBarEntries, visibleNav } from './navigation';

const routes = (groups: ReturnType<typeof visibleNav>) => groups.flatMap((group) => group.entries.map((entry) => entry.route));

describe('navigation table (specs/frontend/design.md §2)', () => {
  it('gives every route one entry', () => {
    const all = ALL_NAV.flatMap((group) => group.entries.map((entry) => entry.route));
    expect(new Set(all).size).toBe(all.length);
  });

  it('shows an Org Operator only the built routes the operator holds', () => {
    expect(routes(visibleNav('ORGANIZATION', ['ORG_OPERATOR']))).toEqual(['/o/map', '/o/contracts']);
  });

  it('adds invoices for the Org Manager through inheritance', () => {
    expect(routes(visibleNav('ORGANIZATION', ['ORG_MANAGER']))).toEqual(['/o/map', '/o/contracts', '/o/invoices']);
  });

  it('gives TrekLink Staff the fleet map, contracts, organizations and billing, and Admin those plus the built administration pages', () => {
    expect(routes(visibleNav('TREKLINK', ['STAFF']))).toEqual(['/t/map', '/t/contracts', '/t/organizations', '/t/billing']);
    expect(routes(visibleNav('TREKLINK', ['ADMIN']))).toEqual(['/t/map', '/t/contracts', '/t/organizations', '/t/billing', '/t/admin/prices']);
  });

  it('keeps Administration for Admin only once its pages are built', () => {
    const staff = visibleNav('TREKLINK', ['STAFF'], { includeUnbuilt: true }).map((group) => group.id);
    const admin = visibleNav('TREKLINK', ['ADMIN'], { includeUnbuilt: true }).map((group) => group.id);
    expect(staff).not.toContain('t-admin');
    expect(admin).toContain('t-admin');
  });

  it('finds the owning entry of a detail path and marks map routes full-bleed', () => {
    const groups = visibleNav('ORGANIZATION', ['ORG_MANAGER']);
    expect(entryForPath(groups, '/o/contracts/abc')?.route).toBe('/o/contracts');
    expect(entryForPath(groups, '/o/contracts/new')?.label).toBe('Contracts');
    expect(isFullBleed('/o/map')).toBe(true);
    expect(isFullBleed('/t/map')).toBe(true);
    expect(isFullBleed('/o/contracts')).toBe(false);
  });

  it('puts at most four entries in the phone tab bar', () => {
    for (const groups of [visibleNav('TREKLINK', ['ADMIN'], { includeUnbuilt: true }), visibleNav('ORGANIZATION', ['ORG_MANAGER'], { includeUnbuilt: true })]) {
      expect(tabBarEntries(groups).length).toBeLessThanOrEqual(4);
    }
  });
});
