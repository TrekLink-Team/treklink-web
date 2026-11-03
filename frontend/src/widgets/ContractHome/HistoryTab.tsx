import React from 'react';
import type { ContractTransition } from '../../entities/contract/api';
import { STATUS_LABELS } from '../../entities/contract/api';
import { REASON_LABELS, transitionLine } from '../../entities/contract/lifecycle';
import { formatDateTime, formatInstantsIn, viewerTimeZone } from '../../shared/lib/format';
import { StatusBadge } from '../../shared/ui/Badge';
import { CollectionView, type CollectionField } from '../../shared/ui/collection-view';
import { ErrorState } from '../../shared/ui/bits';
import { CONTRACT_STATUS } from '../../shared/ui/status';

interface Entry extends ContractTransition {
  key: string;
}

/**
 * The History tab (rentals api-design 18) on CollectionView: each transition as a readable line
 * ("Request approved") with the move as text, who made it, the reason and when.
 */
export const HistoryTab: React.FC<{
  code: string;
  history: ContractTransition[] | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}> = ({ code, history, loading, error, onRetry }) => {
  const entries: Entry[] | undefined = history
    ?.map((step, index) => ({ ...step, key: `${index}-${step.createdAt}` }))
    .reverse();

  const fields: CollectionField<Entry>[] = [
    {
      key: 'move',
      label: 'Move',
      render: (step) => (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          {step.fromStatus ? `${STATUS_LABELS[step.fromStatus]} to` : 'Created as'}
          <StatusBadge entry={CONTRACT_STATUS[step.toStatus]} />
        </span>
      ),
      text: (step) =>
        `${step.fromStatus ? STATUS_LABELS[step.fromStatus] : ''} ${STATUS_LABELS[step.toStatus]}`,
      compact: true,
    },
    {
      key: 'actor',
      label: 'By',
      render: (step) => step.actor ?? 'System',
      text: (step) => step.actor ?? 'System',
      compact: true,
    },
    {
      key: 'reason',
      label: 'Reason',
      render: (step) =>
        step.reason ? (
          (REASON_LABELS[step.reason] ?? formatInstantsIn(step.reason))
        ) : (
          <span className="text-ink-muted">None</span>
        ),
      text: (step) => step.reason ?? '',
    },
    {
      key: 'at',
      label: 'When',
      render: (step) => (
        <time dateTime={step.createdAt} title={viewerTimeZone()}>
          {formatDateTime(step.createdAt)}
        </time>
      ),
      text: (step) => step.createdAt,
      sortValue: (step) => step.createdAt,
      sortable: true,
      compact: true,
    },
  ];

  return (
    <CollectionView<Entry>
      label={`History of ${code}`}
      items={entries}
      loading={loading}
      error={error ? <ErrorState error={error} onRetry={onRetry} /> : undefined}
      itemId={(step) => step.key}
      itemName={(step) => `${transitionLine(step)}, ${formatDateTime(step.createdAt)}`}
      itemTitle={(step) => <span className="font-semibold text-ink">{transitionLine(step)}</span>}
      fields={fields}
      noun={{ one: 'entry', other: 'entries' }}
      views={['list', 'details']}
      defaultView="list"
      search={{ label: 'Search the history' }}
      details={false}
      emptyState={{ title: 'No history yet.' }}
    />
  );
};
