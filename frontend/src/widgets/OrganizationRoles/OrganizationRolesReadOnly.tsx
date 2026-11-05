import React, { useMemo } from 'react';
import { useOrganizationRolesOf } from '../../entities/organization-role/api';
import {
  isCustomised,
  organizationCellOf,
  toGridCatalog,
  toGridRoles,
} from '../../entities/organization-role/model';
import type { Permission, Role } from '../../entities/role/api';
import { sortRoles } from '../../entities/role/model';
import { Skeleton } from '../../shared/ui';
import { ErrorState } from '../../shared/ui/bits';
import { RoleGrid } from '../RoleGrid/RoleGrid';

const NO_DRAFTS = {};
const IGNORE = () => undefined;

// The roles of one organization as the grid of screen 3.7 with every cell disabled and no toolbar, for
// TrekLink Staff and Admin on `/t/organizations/:id` (organizations api-design 33).
export const OrganizationRolesReadOnly: React.FC<{ organizationId: string }> = ({
  organizationId,
}) => {
  const view = useOrganizationRolesOf(organizationId);
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
  return (
    <RoleGrid
      roles={roles}
      catalog={catalog}
      drafts={NO_DRAFTS}
      badKey={null}
      onToggle={IGNORE}
      cellFor={(permission: Permission, role: Role) =>
        organizationCellOf(permission, role, data, NO_DRAFTS)
      }
      lockedFor="Manager"
      customised={(role, key) => isCustomised(data, role.key, key)}
      readOnly
      caption="Permissions by role of this organization"
    />
  );
};
