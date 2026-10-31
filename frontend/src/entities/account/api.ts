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

export type AccountRole = 'STAFF' | 'ADMIN';

export interface CreateAccountInput {
  email: string;
  fullName: string;
  role: AccountRole;
}

// Only the fields that changed are sent (auth api-design 11).
export interface UpdateAccountInput {
  fullName?: string;
  phoneNumber?: string;
  role?: AccountRole;
}

const send = <T>(endpoint: string, method: 'POST' | 'PATCH', body?: object): Promise<T> =>
  apiClient<T>(endpoint, { method, ...(body ? { body: JSON.stringify(body) } : {}) });

// auth api-design 10: 409 CONFLICT_UNIQUE for a registered email; the server sends the invitation.
export const createAccount = (input: CreateAccountInput) =>
  send<AccountItem>('/accounts', 'POST', input);

// auth api-design 11: 409 SELF_DEMOTION when an Admin removes their own Admin role.
export const updateAccount = (id: string, input: UpdateAccountInput) =>
  send<AccountItem>(`/accounts/${id}`, 'PATCH', input);

// auth api-design 12: 409 LAST_ADMIN; the reason is required and sessions end at once.
export const deactivateAccount = (id: string, reason: string) =>
  send<AccountItem>(`/accounts/${id}/deactivate`, 'POST', { reason });

// auth api-design 13.
export const reactivateAccount = (id: string) =>
  send<AccountItem>(`/accounts/${id}/reactivate`, 'POST');

// auth api-design 14: 409 INVALID_STATE_TRANSITION for a deactivated account, 429 OTP_COOLDOWN.
export const sendAccountReset = (id: string) =>
  send<null>(`/accounts/${id}/password-reset`, 'POST');
