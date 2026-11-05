import React from 'react';
import { useOrganizationTransitions } from '../../entities/organization/api';
import { formatDateTime } from '../../shared/lib/format';
import { Skeleton } from '../../shared/ui';
import { ErrorState } from '../../shared/ui/bits';
import { ORGANIZATION_STATUS } from '../../shared/ui/status';

// The status history of organizations api-design 11: one line per change, as the server lists it.
export const OrganizationStatusHistory: React.FC<{ organizationId: string }> = ({
  organizationId,
}) => {
  const history = useOrganizationTransitions(organizationId);
  if (history.isLoading) return <Skeleton className="h-10" />;
  if (history.error) {
    return <ErrorState error={history.error} onRetry={() => void history.refetch()} />;
  }
  if (!history.data || history.data.length === 0) {
    return <p className="text-body-sm text-ink-muted">No status change yet.</p>;
  }
  return (
    <ol className="flex flex-col gap-2">
      {history.data.map((row) => (
        <li key={`${row.createdAt}-${row.toStatus}`} className="text-body-sm">
          <span className="font-semibold text-ink">
            {ORGANIZATION_STATUS[row.fromStatus]?.label ?? row.fromStatus} to{' '}
            {ORGANIZATION_STATUS[row.toStatus]?.label ?? row.toStatus}
          </span>
          <span className="block text-ink-muted">
            {formatDateTime(row.createdAt)}, {row.actor}
            {row.reason ? `: ${row.reason}` : ''}
          </span>
        </li>
      ))}
    </ol>
  );
};
