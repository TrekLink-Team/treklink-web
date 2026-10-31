import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../shared/api/apiClient';
import { queryString, type Page } from '../../shared/api/query';

// The generic audit log as platform api-design 05 returns it (screen 7.4, the change log).
export interface AuditLogItem {
  id: string;
  // Null for a SYSTEM action.
  actor: { id: string; fullName: string } | null;
  actorRoles: string[];
  organizationId: string | null;
  action: string;
  subjectType: string;
  subjectId: string | null;
  // Snapshots with secrets already replaced by the server.
  before: unknown;
  after: unknown;
  requestId: string | null;
  createdAt: string;
}

// The seven filters of the log; `from` is inclusive and `to` exclusive, both ISO 8601 UTC, and
// `action` is a prefix.
export interface AuditFilters {
  actorId?: string;
  organizationId?: string;
  subjectType?: string;
  subjectId?: string;
  action?: string;
  from?: string;
  to?: string;
}

export const AUDIT_PAGE_SIZE = 20;

export const auditKeys = {
  list: (filters: AuditFilters, pageNumber: number) => ['audit-logs', filters, pageNumber] as const,
};

export const fetchAuditLogs = (filters: AuditFilters, pageNumber: number) =>
  apiClient<Page<AuditLogItem>>(
    `/audit-logs${queryString({ ...filters, pageNumber, pageSize: AUDIT_PAGE_SIZE })}`,
  );

export const useAuditLogs = (filters: AuditFilters, pageNumber: number) =>
  useQuery({
    queryKey: auditKeys.list(filters, pageNumber),
    queryFn: () => fetchAuditLogs(filters, pageNumber),
    retry: false,
  });
