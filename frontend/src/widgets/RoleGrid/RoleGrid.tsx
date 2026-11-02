import React from 'react';
import type { Permission, Role } from '../../entities/role/api';
import {
  cellOf,
  groupBySubject,
  isChanged,
  roleTitle,
  scopeText,
  type Drafts,
} from '../../entities/role/model';
import { cn } from '../../shared/ui';

interface Props {
  roles: Role[];
  catalog: Permission[];
  drafts: Drafts;
  // A permission key the server no longer knows: its row is marked.
  badKey: string | null;
  onToggle: (role: Role, permission: Permission) => void;
}

const BOX =
  'h-5 w-5 shrink-0 cursor-pointer rounded border-line-strong accent-[rgb(var(--tl-accent))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed';

// The permission grid of screen 7.2: permissions are rows grouped by subject, every role is a column, a
// cell is one checkbox. A real table inside its own scroll box, header row and first column sticky.
export const RoleGrid: React.FC<Props> = ({ roles, catalog, drafts, badKey, onToggle }) => {
  const groups = groupBySubject(catalog);
  return (
    <div
      role="region"
      aria-label="Permissions by role"
      // A scroll box needs a tab stop so the keyboard can scroll it (WCAG 2.1.1).
      tabIndex={0}
      // The scroll padding is the sticky header and first column: a focused cell is scrolled clear of
      // them (WCAG 2.4.11). The header is three lines tall, about 5.5rem.
      className="max-h-[70vh] scroll-pl-72 scroll-pt-24 overflow-auto rounded-card border border-line bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
    >
      <table className="w-full border-separate border-spacing-0 text-body-sm">
        <caption className="sr-only">Permissions by role</caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky left-0 top-0 z-30 min-w-72 border-b border-line-strong bg-surface px-3 py-2 text-left text-body font-semibold text-ink"
            >
              Permission
            </th>
            {roles.map((role) => (
              <th
                key={role.id}
                scope="col"
                className="sticky top-0 z-20 min-w-36 border-b border-line-strong bg-surface px-3 py-2 text-center align-bottom"
              >
                <span className="block font-mono text-body font-semibold text-ink">{role.key}</span>
                <span className="block text-caption font-normal text-ink-muted">
                  {roleTitle(role.key)},{' '}
                  {role.accountType === 'TREKLINK' ? 'TrekLink' : 'Organization'}
                  {role.isSystem ? ', System role' : ''}
                </span>
                <span className="block text-caption font-normal text-ink-muted">
                  {role.permissionKeys.length}{' '}
                  {role.permissionKeys.length === 1 ? 'permission' : 'permissions'}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map(([subject, permissions]) => (
            <React.Fragment key={subject}>
              <tr>
                <th
                  scope="rowgroup"
                  colSpan={roles.length + 1}
                  className="sticky left-0 border-b border-line bg-sunken px-3 py-1.5 text-left text-caption font-semibold uppercase tracking-wide text-ink-muted"
                >
                  {subject}
                </th>
              </tr>
              {permissions.map((permission) => (
                <tr key={permission.key}>
                  <th
                    scope="row"
                    className="sticky left-0 z-10 border-b border-line bg-surface px-3 py-2 text-left font-normal"
                  >
                    <span className="block font-mono text-body font-medium text-ink">
                      {permission.key}
                    </span>
                    <span className="block text-body-sm text-ink-muted">
                      {permission.description}
                      {badKey === permission.key ? ' This permission no longer exists.' : ''}
                    </span>
                  </th>
                  {roles.map((role) => (
                    <GridCell
                      key={role.id}
                      role={role}
                      permission={permission}
                      roles={roles}
                      drafts={drafts}
                      invalid={badKey === permission.key}
                      onToggle={onToggle}
                    />
                  ))}
                </tr>
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const GridCell: React.FC<{
  role: Role;
  permission: Permission;
  roles: Role[];
  drafts: Drafts;
  invalid: boolean;
  onToggle: (role: Role, permission: Permission) => void;
}> = ({ role, permission, roles, drafts, invalid, onToggle }) => {
  const cell = cellOf(permission, role, roles, drafts);
  if (cell.kind === 'unavailable') {
    return (
      <td className="border-b border-line px-3 py-2 text-center text-caption text-ink-muted">
        Not available
      </td>
    );
  }
  // An inherited cell can hide the role's own draft (unticked on ADMIN, then ticked on STAFF): still marked.
  const changed = cell.kind !== 'locked' && isChanged(role, permission.key, drafts);
  const note =
    cell.kind === 'locked'
      ? 'Required for Admin'
      : cell.kind === 'inherited'
        ? `From ${cell.from}`
        : permission.scope === 'own'
          ? scopeText(permission)
          : null;
  // The note is aria-hidden, so everything it says is also in the name (WCAG 1.3.1).
  const name = `${permission.key} for ${role.key}${
    cell.kind === 'locked'
      ? ', required for Admin'
      : cell.kind === 'inherited'
        ? `, inherited from ${cell.from}`
        : ''
  }${permission.scope === 'own' ? `, ${scopeText(permission).toLowerCase()}` : ''}${
    changed ? ', changed' : ''
  }`;
  return (
    <td
      className={cn(
        'border-b border-line px-3 py-1 text-center',
        changed && 'bg-status-attention-tint',
      )}
    >
      <label className="mx-auto flex min-h-11 min-w-11 cursor-pointer items-center justify-center">
        <input
          type="checkbox"
          className={BOX}
          aria-label={name}
          aria-invalid={invalid || undefined}
          checked={cell.kind === 'editable' ? cell.checked : true}
          disabled={cell.kind !== 'editable'}
          onChange={() => onToggle(role, permission)}
        />
      </label>
      {(note || changed) && (
        <span aria-hidden="true" className="block text-caption text-ink-muted">
          {changed && <span className="font-semibold text-status-attention-fg">Changed</span>}
          {changed && note ? ', ' : ''}
          {note}
        </span>
      )}
    </td>
  );
};
