import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../shared/api/apiClient';

// The roles and the permission catalog as auth api-design 15 and 18 return them (screen 7.2).
export type AccountType = 'TREKLINK' | 'ORGANIZATION';

export interface Role {
  id: string;
  key: string;
  accountType: AccountType;
  isSystem: boolean;
  permissionKeys: string[];
}

export interface Permission {
  key: string;
  action: string;
  subject: string;
  // `own` limits the permission to the holder's organization.
  scope: 'own' | 'any';
  accountType: AccountType;
  description: string;
  // A protected permission cannot be removed from the Admin role (ADMIN_LOCKOUT).
  protected: boolean;
}

export interface SavedRole {
  id: string;
  key: string;
  permissionCount: number;
}

export const roleKeys = {
  roles: ['roles'] as const,
  permissions: ['permissions'] as const,
};

export const fetchRoles = () => apiClient<Role[]>('/roles');
export const fetchPermissions = () => apiClient<Permission[]>('/permissions');

// Both are read once: all four roles in one response, the whole catalog in the other.
export const useRoles = () =>
  useQuery({ queryKey: roleKeys.roles, queryFn: fetchRoles, retry: false });
export const usePermissions = () =>
  useQuery({
    queryKey: roleKeys.permissions,
    queryFn: fetchPermissions,
    retry: false,
    staleTime: Infinity,
  });

// auth api-design 16: the full list of keys replaces what the role holds.
export const saveRolePermissions = (id: string, permissionKeys: string[]) =>
  apiClient<SavedRole>(`/roles/${id}/permissions`, {
    method: 'PUT',
    body: JSON.stringify({ permissionKeys }),
  });
