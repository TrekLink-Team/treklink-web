import React, { useState } from 'react';
import { HISTORY_PAGE_SIZE, useParameterHistory } from '../../entities/parameter/api';
import { valueText } from '../../entities/parameter/model';
import { formatDateTime } from '../../shared/lib/format';
import { Alert, Button, Drawer, Pagination, Skeleton } from '../../shared/ui';
import { messageOf } from '../../shared/ui/errors';

// The right-hand drawer of screen 7.4: the append-only change history of one parameter, newest first,
// ten to a page (platform api-design 04). Focus returns to the History button that opened it.
export const ParameterHistoryDrawer: React.FC<{ parameterKey: string; onClose: () => void }> = ({
  parameterKey,
  onClose,
}) => {
  const [pageNumber, setPageNumber] = useState(1);
  const history = useParameterHistory(parameterKey, pageNumber);
  const data = history.data;

  return (
    <Drawer
      titleId="parameter-history-title"
      title={`History of ${parameterKey}`}
      onClose={onClose}
      footer={
        data && data.totalPages > 1 ? (
          <Pagination
            pageNumber={pageNumber}
            totalPages={data.totalPages}
            totalItems={data.totalCount}
            pageSize={HISTORY_PAGE_SIZE}
            onPage={setPageNumber}
            className="border-t-0 px-0 py-0"
          />
        ) : undefined
      }
    >
      {history.isPending && (
        <div role="status" aria-label="Loading history" className="flex flex-col gap-3">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-16" />
          ))}
        </div>
      )}
      {history.isError && (
        <Alert
          tone="error"
          action={
            <Button variant="secondary" size="sm" onClick={() => void history.refetch()}>
              Retry
            </Button>
          }
        >
          {messageOf(history.error)}
        </Alert>
      )}
      {data && data.items.length === 0 && (
        <p className="text-body text-ink-muted">This parameter has not been changed since the seed.</p>
      )}
      {data && data.items.length > 0 && (
        <ol className="flex flex-col gap-3">
          {data.items.map((item) => (
            <li
              key={item.changedAt}
              className="rounded-card border border-line bg-surface px-3 py-2.5 text-body"
            >
              <p className="font-semibold text-ink">
                <span className="font-mono">{valueText(item.previousValue)}</span>
                {' to '}
                <span className="font-mono">{valueText(item.newValue)}</span>
              </p>
              <p className="text-body-sm text-ink-muted">
                {item.changedBy?.fullName ?? 'SYSTEM'}, {formatDateTime(item.changedAt)}
              </p>
              {item.reason && <p className="text-body-sm text-ink">Reason: {item.reason}</p>}
            </li>
          ))}
        </ol>
      )}
    </Drawer>
  );
};
