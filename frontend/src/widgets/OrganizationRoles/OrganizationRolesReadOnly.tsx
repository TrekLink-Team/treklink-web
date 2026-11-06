import React, { useMemo, useState } from 'react';
import { useOrganizationRolesOf } from '../../entities/organization-role/api';
import {
  isCustomised,
  organizationCellOf,
  toGridCatalog,
  toGridRoles,
} from '../../entities/organization-role/model';
import type { Permission, Role } from '../../entities/role/api';
import { groupBySubject, roleTitle, scopeText, sortRoles } from '../../entities/role/model';
import { useMediaQuery } from '../../shared/lib/useMediaQuery';
import { Badge, Card, Checkbox, Select, Skeleton } from '../../shared/ui';
import { ErrorState } from '../../shared/ui/bits';
import { RoleGrid } from '../RoleGrid/RoleGrid';

const NO_DRAFTS = {};
const IGNORE = () => undefined;

// The roles of one organization as the grid of screen 3.7 with every cell disabled and no toolbar, for
// TrekLink Staff and Admin on `/t/organizations/:id` (organizations api-design 33). Below 768 px the
// grid would leave no room for a role column, so one role is shown at a time, picked in a select, as on
// the editing page `/o/roles`.
export const OrganizationRolesReadOnly: React.FC<{ organizationId: string }> = ({
  organizationId,
}) => {
  const view = useOrganizationRolesOf(organizationId);
  const wide = useMediaQuery('(min-width: 768px)', true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const roles = useMemo(
    () => (view.data ? sortRoles(toGridRoles(view.data)) : undefined),
    [view.data],
  );
  const catalog = useMemo(
    () => (view.data ? toGridCatalog(view.data.catalog) : undefined),
    [view.data],
  );

  if (view.isPending) return <Skeleton className="h-64 w-full" />;
  const data = view.data;
  if (view.error || !data || !roles || !catalog) {
    return <ErrorState error={view.error} onRetry={() => void view.refetch()} />;
  }
  const cellFor = (permission: Permission, role: Role) =>
    organizationCellOf(permission, role, data, NO_DRAFTS);
  if (wide) {
    // The grid's own scroll box fills its parent (`flex-1`); inside a card it has no flex parent, so its
    // height was its content and it leaked into `#main` (review of treklink-web#389). This wrapper
    // gives it a ceiling: it scrolls inside itself and the page body keeps one scroll region.
    return (
      <div data-roles-grid-frame="" className="flex max-h-[32rem] min-h-0 flex-col">
        <RoleGrid
          roles={roles}
          catalog={catalog}
          drafts={NO_DRAFTS}
          badKey={null}
          onToggle={IGNORE}
          cellFor={cellFor}
          lockedFor="Manager"
          customised={(role, key) => isCustomised(data, role.key, key)}
          readOnly
          caption="Permissions by role of this organization"
        />
      </div>
    );
  }
  const role = roles.find((item) => item.id === selectedId) ?? roles[0];
  return (
    <div className="flex flex-col gap-4">
      <div>
        <label
          htmlFor="organization-roles-select"
          className="mb-1.5 block text-body-sm font-semibold text-ink"
        >
          Role
        </label>
        <Select
          id="organization-roles-select"
          value={role.id}
          onChange={(event) => setSelectedId(event.target.value)}
        >
          {roles.map((item) => (
            <option key={item.id} value={item.id}>
              {item.key}
            </option>
          ))}
        </Select>
      </div>
      <Card aria-labelledby="organization-role-panel-title">
        <h3 id="organization-role-panel-title" className="text-title text-ink">
          {role.key}
        </h3>
        <p className="mb-4 flex flex-wrap items-center gap-2 text-body-sm text-ink-muted">
          {roleTitle(role.key)}, Organization
          <Badge>System role</Badge>
        </p>
        <div className="flex flex-col gap-4">
          {groupBySubject(catalog).map(([subject, permissions]) => (
            <fieldset key={subject} className="m-0 min-w-0 border-0 p-0">
              <legend className="mb-1 text-body font-semibold text-ink">{subject}</legend>
              {permissions.map((permission) => {
                const cell = cellFor(permission, role);
                if (cell.kind === 'unavailable') return null;
                const note =
                  cell.kind === 'locked'
                    ? ' Required for Manager.'
                    : cell.kind === 'inherited'
                      ? ` From ${cell.from}.`
                      : '';
                return (
                  <Checkbox
                    key={permission.key}
                    label={permission.key}
                    description={`${permission.scope === 'own' ? `${scopeText(permission)}. ` : ''}${permission.description}${note}${
                      isCustomised(data, role.key, permission.key) ? ' Customised.' : ''
                    }`}
                    checked={cell.kind === 'editable' ? cell.checked : true}
                    disabled
                    onChange={IGNORE}
                  />
                );
              })}
            </fieldset>
          ))}
        </div>
      </Card>
    </div>
  );
};
