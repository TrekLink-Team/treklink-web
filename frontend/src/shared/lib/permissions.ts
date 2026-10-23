// Roles as GET /api/auth/me returns them (auth api-design 04).
export type Role = 'ADMIN' | 'STAFF' | 'ORG_MANAGER' | 'ORG_OPERATOR';

// TrekLink Admin inherits every TrekLink Staff route, and Org Manager every Org Operator route
// (specs/frontend/design.md §2, FR-AUTH-10). The server stays the authority; this only decides which
// routes and entries the client shows.
const INHERITED: Record<Role, readonly Role[]> = {
  ADMIN: ['ADMIN', 'STAFF'],
  STAFF: ['STAFF'],
  ORG_MANAGER: ['ORG_MANAGER', 'ORG_OPERATOR'],
  ORG_OPERATOR: ['ORG_OPERATOR'],
};

const isRole = (value: string): value is Role => value in INHERITED;

export const effectiveRoles = (roles: readonly string[]): Set<Role> =>
  new Set(roles.filter(isRole).flatMap((role) => INHERITED[role]));

export const hasAnyRole = (roles: readonly string[], allowed: readonly Role[]): boolean => {
  const held = effectiveRoles(roles);
  return allowed.some((role) => held.has(role));
};
