import type { Permission, Role } from '../role/api';
import type { Cell, Drafts } from '../role/model';
import type { OrganizationPermission, OrganizationRole, OrganizationRoles } from './api';

// Screen 3.7 draws the grid of 7.2 (`RoleGrid`, the draft helpers of `entities/role/model`): the roles of
// the organization are shown as `Role` rows with their effective keys as the saved set, and the ceiling as
// the permission catalog. Only the cell rules differ (specs/frontend/ui-design/3-7).

export const toGridRoles = (view: OrganizationRoles): Role[] =>
  view.roles.map((role) => ({
    id: role.key,
    key: role.key,
    accountType: 'ORGANIZATION',
    isSystem: true,
    permissionKeys: role.effectiveKeys,
  }));

export const toGridCatalog = (permissions: OrganizationPermission[]): Permission[] =>
  permissions.map((permission) => ({ ...permission, description: permission.description ?? '' }));

const roleOf = (view: OrganizationRoles, key: string): OrganizationRole | undefined =>
  view.roles.find((role) => role.key === key);

// What one cell shows: no box for a protected permission on the Operator (it cannot be granted below the
// Manager), a read-only tick for it on the Manager, a read-only tick on the Manager for what the TrekLink
// baseline of the Operator holds (an Operator draft does not change it, auth REQ-UBI-10, AC-10), a box
// otherwise.
export const organizationCellOf = (
  permission: Permission,
  role: Role,
  view: OrganizationRoles,
  drafts: Drafts,
): Cell => {
  if (permission.protected) {
    return role.key === 'ORG_MANAGER' ? { kind: 'locked' } : { kind: 'unavailable' };
  }
  if (
    role.key === 'ORG_MANAGER' &&
    roleOf(view, 'ORG_OPERATOR')?.baselineKeys.includes(permission.key)
  ) {
    return { kind: 'inherited', from: 'ORG_OPERATOR' };
  }
  const keys = drafts[role.id] ?? new Set(role.permissionKeys);
  return { kind: 'editable', checked: keys.has(permission.key) };
};

// The saved set of the role differs from the TrekLink default for this permission.
export const isCustomised = (view: OrganizationRoles, roleKey: string, key: string): boolean => {
  const role = roleOf(view, roleKey);
  return role ? role.baselineKeys.includes(key) !== role.effectiveKeys.includes(key) : false;
};

// "Reset to TrekLink default": the draft of one role becomes its baseline.
export const resetDraft = (view: OrganizationRoles, roleKey: string, drafts: Drafts): Drafts => {
  const role = roleOf(view, roleKey);
  return role ? { ...drafts, [role.key]: new Set(role.baselineKeys) } : drafts;
};

// A role that differs from its default has something to reset: the saved set or the draft.
export const canReset = (view: OrganizationRoles, roleKey: string, drafts: Drafts): boolean => {
  const role = roleOf(view, roleKey);
  if (!role) return false;
  const shown = drafts[role.key] ?? new Set(role.effectiveKeys);
  return (
    shown.size !== role.baselineKeys.length || role.baselineKeys.some((key) => !shown.has(key))
  );
};

// The version read with each role: the `expectedVersion` of its save.
export const versionOf = (view: OrganizationRoles, roleKey: string): number =>
  roleOf(view, roleKey)?.version ?? 0;
