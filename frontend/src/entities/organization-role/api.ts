import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../shared/api/apiClient';

// The roles of the caller's own organization as auth api-design 19 and 20 return them (screen 3.7).
export type OrganizationRoleKey = 'ORG_MANAGER' | 'ORG_OPERATOR';

export interface OrganizationRole {
  key: OrganizationRoleKey;
  // The count of saves: the `expectedVersion` of the next one. 0 until a Manager has saved the role.
  version: number;
  // The TrekLink default the Admin set on screen 7.2.
  baselineKeys: string[];
  // What the role holds in this organization.
  effectiveKeys: string[];
}

// A permission inside the ceiling; the rows of the grid.
export interface OrganizationPermission {
  key: string;
  action: string;
  subject: string;
  scope: 'own' | 'any';
  accountType: 'ORGANIZATION';
  description: string | null;
  // `organizationRole.manage.own`: the Manager always holds it and the Operator never can.
  protected: boolean;
}

export interface OrganizationRoles {
  roles: OrganizationRole[];
  catalog: OrganizationPermission[];
}

export interface SavedOrganizationRole {
  key: OrganizationRoleKey;
  version: number;
  effectiveKeys: string[];
}

export const organizationRoleKeys = {
  all: ['organization-roles'] as const,
};

export const fetchOrganizationRoles = () => apiClient<OrganizationRoles>('/organization/roles');

export const useOrganizationRoles = () =>
  useQuery({
    queryKey: organizationRoleKeys.all,
    queryFn: fetchOrganizationRoles,
    retry: false,
  });

// auth api-design 20: the full list of effective keys of one role and the version read with it.
export const saveOrganizationRole = (
  key: OrganizationRoleKey,
  permissionKeys: string[],
  expectedVersion: number,
) =>
  apiClient<SavedOrganizationRole>(`/organization/roles/${key}/permissions`, {
    method: 'PUT',
    body: JSON.stringify({ permissionKeys, expectedVersion }),
  });
