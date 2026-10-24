// Display helpers of the account menu (screen 2.2).

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Admin',
  STAFF: 'Staff',
  ORG_MANAGER: 'Org Manager',
  ORG_OPERATOR: 'Org Operator',
};

export const roleLabel = (roles: readonly string[]): string =>
  roles.map((role) => ROLE_LABELS[role] ?? role).join(', ');

// The header shows only these at 360 px (screen 2.2): the first letters of the last two names.
export const initialsOf = (fullName: string): string =>
  fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((part) => part[0].toUpperCase())
    .join('');

export const DISCARD_PROMPT = 'Discard the password change?';
