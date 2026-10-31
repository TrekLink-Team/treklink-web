import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../shared/api/apiClient';
import { queryString, type Page } from '../../shared/api/query';

// One row of auth api-design 09, the TrekLink accounts list (screens 7.1 and 7.3).
export interface AccountItem {
  id: string;
  email: string;
  fullName: string;
  phoneNumber: string | null;
  accountType: 'TREKLINK';
  roles: string[];
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AccountFilters {
  q?: string;
  isActive?: boolean;
}

export const ACCOUNT_PAGE_SIZE = 20;

export const accountKeys = {
  all: ['accounts'] as const,
  list: (filters: AccountFilters, pageNumber: number) => ['accounts', filters, pageNumber] as const,
};

export const fetchAccounts = (
  filters: AccountFilters,
  pageNumber: number,
  pageSize = ACCOUNT_PAGE_SIZE,
) => apiClient<Page<AccountItem>>(`/accounts${queryString({ ...filters, pageNumber, pageSize })}`);

export const useAccounts = (
  filters: AccountFilters,
  pageNumber: number,
  options?: { enabled?: boolean; pageSize?: number },
) =>
  useQuery({
    queryKey: accountKeys.list(filters, pageNumber),
    queryFn: () => fetchAccounts(filters, pageNumber, options?.pageSize),
    enabled: options?.enabled,
    retry: false,
  });
