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
import { formatDate, formatDateTime, formatVnd } from '../shared/lib/format';
import {
  DataTable,
  Field,
  PageHeader,
  Pagination,
  Select,
  StatusBadge,
  type Column,
} from '../shared/ui';
import { ErrorState } from '../shared/ui/bits';
import { LINK } from '../shared/ui/styles';

const MSG01 = 'No results match your filters.';

const chargeText = (item: LossCase) =>
  item.state === 'SETTLED' && item.decision
    ? `${DECISION_LABEL[item.decision]}${item.chargeVnd !== null ? `, ${formatVnd(item.chargeVnd)}` : ''}`
    : 'Not settled';

// /t/loss-cases and /o/loss-cases, screen 4.4 (devices api-design 18; UC-49, UC-60). TrekLink Staff
// and Admin see every case with its organization and custody and open it; the Org Manager sees the
// organization's cases read only, with the decision and charge once settled, never the theft fields.
export const LossCasesPage: React.FC<{ scope: LossScope }> = ({ scope }) => {
  const [state, setState] = useState<LossCaseState | ''>('');
  const [pageNumber, setPageNumber] = useState(1);
  const cases = useLossCases(scope, state === '' ? undefined : state, pageNumber);
  const trekLink = scope === 't';

  const code = (item: LossCase) =>
    trekLink ? (
      <Link to={`/t/loss-cases/${item.id}`} className={`${LINK} font-mono`}>
        {item.code}
      </Link>
    ) : (
      <span className="font-mono">{item.code}</span>
    );

  const columns: Column<LossCase>[] = [
    { key: 'code', header: 'Code', cell: code },
    { key: 'device', header: 'Device', cell: (item) => <span className="font-mono">{item.device.assetTag}</span> },
    { key: 'state', header: 'State', cell: (item) => <StatusBadge entry={LOSS_CASE_STATE[item.state]} /> },
    {
      key: 'reported',
      header: 'Reported',
      cell: (item) => <span className="whitespace-nowrap">{formatDateTime(item.reportedAt)}</span>,
    },
    ...(trekLink
      ? ([
          {
            key: 'organization',
            header: 'Organization',
            cell: (item) => <span className="font-mono">{item.organization?.code ?? 'None'}</span>,
          },
          {
            key: 'custody',
            header: 'Custody',
            cell: (item) => (item.custody ? CUSTODY_LABEL[item.custody] : 'Not triaged'),
          },
        ] satisfies Column<LossCase>[])
      : []),
    { key: 'settlement', header: 'Settlement', cell: chargeText },
  ];

  const empty = state !== '' ? MSG01 : trekLink ? 'No loss cases.' : 'Your organization has no loss cases.';

  return (
    <section aria-labelledby="loss-cases-title">
      <PageHeader
        id="loss-cases-title"
        title="Loss cases"
        meta={cases.data ? `${cases.data.totalCount} ${cases.data.totalCount === 1 ? 'case' : 'cases'}` : undefined}
      />
      <div className="mb-4 max-w-xs">
        <Field id="loss-state" label="State">
          <Select
            id="loss-state"
            value={state}
            onChange={(event) => {
              setState(event.target.value as LossCaseState | '');
              setPageNumber(1);
            }}
          >
            <option value="">All states</option>
            {LOSS_CASE_STATES.map((key) => (
              <option key={key} value={key}>
                {LOSS_CASE_STATE[key].label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <DataTable
        caption="Loss cases"
        columns={columns}
        rows={cases.data?.items}
        rowId={(item) => item.id}
        loading={cases.isLoading}
        error={cases.error ? <ErrorState error={cases.error} onRetry={() => void cases.refetch()} /> : undefined}
        empty={{ title: empty }}
        renderCard={(item) => (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              {code(item)}
              <StatusBadge entry={LOSS_CASE_STATE[item.state]} />
            </div>
            <p className="font-mono text-body-sm text-ink">{item.device.assetTag}</p>
            <p className="text-body-sm text-ink-muted">Reported {formatDate(item.reportedAt)}</p>
            {item.state === 'SETTLED' && <p className="text-body-sm text-ink">{chargeText(item)}</p>}
          </div>
        )}
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
