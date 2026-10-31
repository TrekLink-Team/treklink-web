import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../shared/api/apiClient';
import { queryString, type Page } from '../../shared/api/query';

// The 11 values of `AuthEventType` in backend/prisma/schema.prisma.
export const AUTH_EVENT_TYPES = [
  'LOGIN_SUCCEEDED',
  'LOGIN_FAILED',
  'LOGOUT',
  'TOKEN_REFRESHED',
  'TOKEN_REUSE_DETECTED',
  'PASSWORD_SET',
  'PASSWORD_RESET_REQUESTED',
  'PASSWORD_RESET_COMPLETED',
  'ACCOUNT_LOCKED',
  'ACCOUNT_DEACTIVATED',
  'ACCOUNT_REACTIVATED',
] as const;

export type AuthEventType = (typeof AUTH_EVENT_TYPES)[number];

// One row of auth api-design 17 (screen 7.3). The log never holds an attempted password.
export interface AuthEventItem {
  id: string;
  // Null when the email matched no account.
  userId: string | null;
  email: string | null;
  // Null when the attempt matched no account, or the account has no organization.
  organization: { id: string; name: string } | null;
  type: AuthEventType;
  ip: string | null;
  createdAt: string;
}

// The four filters; `from` is inclusive and `to` exclusive, both ISO 8601 UTC.
export interface AuthEventFilters {
  userId?: string;
  organizationId?: string;
  type?: AuthEventType;
  from?: string;
  to?: string;
}

export const AUTH_EVENT_PAGE_SIZE = 20;

export const authEventKeys = {
  list: (filters: AuthEventFilters, pageNumber: number) =>
    ['auth-events', filters, pageNumber] as const,
};

export const fetchAuthEvents = (filters: AuthEventFilters, pageNumber: number) =>
  apiClient<Page<AuthEventItem>>(
    `/auth-events${queryString({ ...filters, pageNumber, pageSize: AUTH_EVENT_PAGE_SIZE })}`,
  );

export const useAuthEvents = (filters: AuthEventFilters, pageNumber: number) =>
  useQuery({
    queryKey: authEventKeys.list(filters, pageNumber),
    queryFn: () => fetchAuthEvents(filters, pageNumber),
    retry: false,
  });
