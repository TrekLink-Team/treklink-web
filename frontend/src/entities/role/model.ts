import type { Permission, Role } from './api';

// The permissions a role may hold: the catalog filtered to the role's account type, so an organization
// role never lists a platform permission (D-057 rule 2).
export const catalogFor = (role: Role, catalog: Permission[]): Permission[] =>
  catalog.filter((permission) => permission.accountType === role.accountType);

// Checkboxes are grouped by subject, subjects and their permissions in a stable order.
export const groupBySubject = (permissions: Permission[]): [string, Permission[]][] => {
  const groups = new Map<string, Permission[]>();
  for (const permission of permissions) {
    groups.set(permission.subject, [...(groups.get(permission.subject) ?? []), permission]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([subject, list]) => [subject, [...list].sort((a, b) => a.key.localeCompare(b.key))]);
};

export const scopeText = (permission: Permission): string =>
  permission.scope === 'own' ? 'Own organization only' : 'Any organization';

export interface Diff {
  added: string[];
  removed: string[];
}

export const diffOf = (loaded: readonly string[], draft: ReadonlySet<string>): Diff => {
  const before = new Set(loaded);
  return {
    added: [...draft].filter((key) => !before.has(key)).sort(),
    removed: loaded.filter((key) => !draft.has(key)).sort(),
  };
};

export const isDirty = (diff: Diff): boolean => diff.added.length > 0 || diff.removed.length > 0;

// "Change ORG_OPERATOR: remove 1, add 2?" with only the parts that apply.
export const diffSentence = (roleKey: string, diff: Diff): string => {
  const parts = [
    ...(diff.removed.length > 0 ? [`remove ${diff.removed.length}`] : []),
    ...(diff.added.length > 0 ? [`add ${diff.added.length}`] : []),
  ];
  return `Change ${roleKey}: ${parts.join(', ')}?`;
};

// A role keeps the permissions of the role below it (REQ-UBI-05): shown as a note, never as rows.
export const INHERITS: Record<string, string> = { ADMIN: 'STAFF', ORG_MANAGER: 'ORG_OPERATOR' };

// The role key as a name for people.
export const roleTitle = (key: string): string =>
  key
    .split('_')
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');

// The columns of the grid: the platform roles first, each role above the one it inherits from.
const ROLE_ORDER = ['ADMIN', 'STAFF', 'ORG_MANAGER', 'ORG_OPERATOR'];

export const sortRoles = (roles: readonly Role[]): Role[] => {
  const rank = (key: string) => {
    const index = ROLE_ORDER.indexOf(key);
    return index < 0 ? ROLE_ORDER.length : index;
  };
  return [...roles].sort((a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key));
};

// The unsaved sets of the roles that were touched, by role id. A role without an entry shows what is saved.
export type Drafts = Readonly<Record<string, ReadonlySet<string>>>;

export const keysOf = (role: Role, drafts: Drafts): ReadonlySet<string> =>
  drafts[role.id] ?? new Set(role.permissionKeys);

export const toggled = (role: Role, permissionKey: string, drafts: Drafts): Drafts => {
  const next = new Set(keysOf(role, drafts));
  if (next.has(permissionKey)) next.delete(permissionKey);
  else next.add(permissionKey);
  return { ...drafts, [role.id]: next };
};

export const isChanged = (role: Role, permissionKey: string, drafts: Drafts): boolean =>
  role.permissionKeys.includes(permissionKey) !== keysOf(role, drafts).has(permissionKey);

// The drafts without the keys the catalog no longer holds, so a reload after `UNKNOWN_PERMISSION` does not
// leave a key in the draft that no row shows. The same object when nothing is dropped.
export const pruned = (drafts: Drafts, known: ReadonlySet<string>): Drafts => {
  let dropped = false;
  const next: Record<string, ReadonlySet<string>> = {};
  for (const [id, keys] of Object.entries(drafts)) {
    const kept = new Set([...keys].filter((key) => known.has(key)));
    if (kept.size !== keys.size) dropped = true;
    next[id] = kept;
  }
  return dropped ? next : drafts;
};

export interface RoleDiff {
  role: Role;
  diff: Diff;
}

// The roles whose draft differs from what is saved, in column order.
export const changedRoles = (roles: readonly Role[], drafts: Drafts): RoleDiff[] =>
  roles
    .map((role) => ({ role, diff: diffOf(role.permissionKeys, keysOf(role, drafts)) }))
    .filter(({ diff }) => isDirty(diff));

// "2 changes in 2 roles", for the status region beside the buttons.
export const changeSummary = (changed: readonly RoleDiff[]): string => {
  if (changed.length === 0) return 'No changes';
  const count = changed.reduce((sum, { diff }) => sum + diff.added.length + diff.removed.length, 0);
  return `${count} ${count === 1 ? 'change' : 'changes'} in ${changed.length} ${
    changed.length === 1 ? 'role' : 'roles'
  }`;
};

// The title of the confirmation: the sentence of the one role, or the count of roles.
export const confirmTitle = (changed: readonly RoleDiff[]): string =>
  changed.length === 1
    ? diffSentence(changed[0].role.key, changed[0].diff)
    : `Change ${changed.length} roles?`;

// What one cell of the grid shows (screen 7.2): no box for a permission of the other account type, a
// read-only tick for a protected permission on ADMIN or one the role below it holds, a box otherwise.
export type Cell =
  | { kind: 'unavailable' }
  | { kind: 'locked' }
  | { kind: 'inherited'; from: string }
  | { kind: 'editable'; checked: boolean };

export const cellOf = (
  permission: Permission,
  role: Role,
  roles: readonly Role[],
  drafts: Drafts,
): Cell => {
  if (permission.accountType !== role.accountType) return { kind: 'unavailable' };
  if (role.key === 'ADMIN' && permission.protected) return { kind: 'locked' };
  const from = INHERITS[role.key];
  const lower = from ? roles.find((item) => item.key === from) : undefined;
  if (lower && keysOf(lower, drafts).has(permission.key)) return { kind: 'inherited', from };
  return { kind: 'editable', checked: keysOf(role, drafts).has(permission.key) };
};
