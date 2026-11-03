import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CUSTODY_LABEL,
  DECISION_LABEL,
  LOSS_CASE_STATE,
  LOSS_CASE_STATES,
  LOSS_PAGE_SIZE,
  useLossCases,
  type LossCase,
  type LossCaseState,
  type LossScope,
} from '../entities/loss-case/api';
import { formatDateTime, formatVnd } from '../shared/lib/format';
import {
  CollectionView,
  PageHeader,
  Pagination,
  pageInfoOf,
  StatusBadge,
  type CollectionField,
} from '../shared/ui';
import { ErrorState } from '../shared/ui/bits';
import { LINK } from '../shared/ui/styles';

const chargeText = (item: LossCase) =>
  item.state === 'SETTLED' && item.decision
    ? `${DECISION_LABEL[item.decision]}${item.chargeVnd !== null ? `, ${formatVnd(item.chargeVnd)}` : ''}`
    : 'Not settled';

// /t/loss-cases and /o/loss-cases, screen 4.4 (devices api-design 18; UC-49, UC-60) on CollectionView
// (chapter 06 §9, D-096). TrekLink Staff and Admin see every case with its organization and custody and
// open it; the Org Manager sees the organization's cases read only, with the decision and charge once
// settled, never the theft fields. The state is the Show filter on the server.
export const LossCasesPage: React.FC<{ scope: LossScope }> = ({ scope }) => {
  const [state, setState] = useState<LossCaseState | ''>('');
  const [pageNumber, setPageNumber] = useState(1);
  const cases = useLossCases(scope, state === '' ? undefined : state, pageNumber);
  const trekLink = scope === 't';

  const fields: CollectionField<LossCase>[] = [
    {
      key: 'device',
      label: 'Device',
      render: (item) => <span className="font-mono">{item.device.assetTag}</span>,
      compact: true,
    },
    { key: 'state', label: 'State', render: (item) => <StatusBadge entry={LOSS_CASE_STATE[item.state]} />, compact: true },
    {
      key: 'reported',
      label: 'Reported',
      render: (item) => <span className="whitespace-nowrap">{formatDateTime(item.reportedAt)}</span>,
      hideWithPane: true,
    },
    ...(trekLink
      ? ([
          {
            key: 'organization',
            label: 'Organization',
            render: (item) => <span className="font-mono">{item.organization?.code ?? 'None'}</span>,
            hideWithPane: true,
          },
          {
            key: 'custody',
            label: 'Custody',
            render: (item) => (item.custody ? CUSTODY_LABEL[item.custody] : 'Not triaged'),
          },
        ] satisfies CollectionField<LossCase>[])
      : []),
    { key: 'settlement', label: 'Settlement', render: chargeText },
  ];

  return (
    <section aria-labelledby="loss-cases-title" className="flex flex-col gap-4">
      <PageHeader
        id="loss-cases-title"
        title="Loss cases"
        meta={cases.data ? `${cases.data.totalCount} ${cases.data.totalCount === 1 ? 'case' : 'cases'}` : undefined}
      />
      <CollectionView<LossCase>
        label="Loss cases"
        items={cases.data?.items}
        loading={cases.isLoading}
        error={cases.error ? <ErrorState error={cases.error} onRetry={() => void cases.refetch()} /> : undefined}
        itemId={(item) => item.id}
        itemName={(item) => item.code}
        itemTitle={(item) =>
          trekLink ? (
            <Link to={`/t/loss-cases/${item.id}`} className={`${LINK} inline-flex min-h-6 items-center font-mono`}>
              {item.code}
            </Link>
          ) : (
            <span className="font-mono font-semibold text-ink">{item.code}</span>
          )
        }
        fields={fields}
        noun={{ one: 'case', other: 'cases' }}
        filters={[
          { key: '', label: 'All states' },
          ...LOSS_CASE_STATES.map((key) => ({ key, label: LOSS_CASE_STATE[key].label })),
        ]}
        query={{ search: '', filter: state, sort: null }}
        onQueryChange={(next) => {
          setState(next.filter as LossCaseState | '');
          setPageNumber(1);
        }}
        pageInfo={pageInfoOf(cases.data)}
        details={{
          href: trekLink ? (item) => `/t/loss-cases/${item.id}` : undefined,
          hrefLabel: 'Open the case',
        }}
        emptyState={{ title: trekLink ? 'No loss cases.' : 'Your organization has no loss cases.' }}
        footer={
          cases.data && cases.data.totalPages > 1 ? (
            <Pagination
              pageNumber={cases.data.pageNumber}
              totalPages={cases.data.totalPages}
              totalItems={cases.data.totalCount}
              pageSize={cases.data.pageSize || LOSS_PAGE_SIZE}
              onPage={setPageNumber}
            />
          ) : undefined
        }
      />
    </section>
  );
};
