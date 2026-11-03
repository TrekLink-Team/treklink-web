// The permissions of an organization role after its organization's changes (D-095, specs/auth/design.md
// §9.3). Pure: the cache reads the baselines and the stored difference, this module combines them.

export const ORGANIZATION_ROLES = ['ORG_MANAGER', 'ORG_OPERATOR'] as const;
export type OrganizationRoleKey = (typeof ORGANIZATION_ROLES)[number];

export const isOrganizationRole = (key: string): key is OrganizationRoleKey =>
  (ORGANIZATION_ROLES as readonly string[]).includes(key);

// Permissions the Manager of every organization keeps whatever the organization stores (REQ-UBI-12).
export const MANAGER_PROTECTED: readonly string[] = ['organizationRole.manage.own'];

// The grants and revokes one organization stored for one role, as permission keys.
export interface PolicyDelta {
  grants: readonly string[];
  revokes: readonly string[];
}

export const NO_DELTA: PolicyDelta = { grants: [], revokes: [] };

// The rows of `role_permissions` of the two organization roles, as permission keys.
export interface Baselines {
  manager: ReadonlySet<string>;
  operator: ReadonlySet<string>;
}

// own(R) = ((B(R) ∪ G) ∖ V) ∩ C, with C the baseline of ORG_MANAGER (the ceiling). The Operator holds
// own(ORG_OPERATOR). The Manager holds own(ORG_MANAGER) and the baseline of ORG_OPERATOR, never what the
// organization stored for the Operator (REQ-UBI-05, OQ-01), and always the protected permissions.
export const effectiveKeys = (
  role: OrganizationRoleKey,
  baselines: Baselines,
  delta: PolicyDelta,
): Set<string> => {
  // The rows of ORG_MANAGER hold every row of ORG_OPERATOR (FR-AUTH-10), so the union is the baseline of the
  // Manager; it also keeps the ceiling whole in a database where that grant is missing.
  const ceiling = new Set([...baselines.manager, ...baselines.operator]);
  const baseline = role === 'ORG_MANAGER' ? baselines.manager : baselines.operator;
  const revoked = new Set(delta.revokes);
  const own = new Set<string>();
  for (const key of [...baseline, ...delta.grants]) {
    if (!revoked.has(key) && ceiling.has(key)) own.add(key);
  }
  if (role === 'ORG_OPERATOR') return own;
  for (const key of baselines.operator) if (ceiling.has(key)) own.add(key);
  for (const key of MANAGER_PROTECTED) own.add(key);
  return own;
};
