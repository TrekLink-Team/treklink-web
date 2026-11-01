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
