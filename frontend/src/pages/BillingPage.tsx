import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  usePayments,
  useInvoices,
  type InvoiceFilters,
  type PaymentFilters,
} from '../entities/billing/api';

type PaymentRow = NonNullable<ReturnType<typeof usePayments>['data']>['items'][number];
import { formatDateTime, formatVnd } from '../shared/lib/format';
import { ErrorState, PageTitle } from '../shared/ui/bits';
import { Badge } from '../shared/ui/Badge';
import { Pagination } from '../shared/ui/DataTable';
import { CollectionView, pageInfoOf, type CollectionField } from '../shared/ui/collection-view';
import { TAB } from '../shared/ui/styles';
import { matchesText } from '../shared/lib/filter';
import { InvoiceDetailView } from '../widgets/InvoiceDetail/InvoiceDetailView';
import { InvoiceTable } from '../widgets/InvoiceDetail/InvoiceTable';
import { InvoiceFilterBar } from './InvoicesPage';

const PAYMENT_STATUSES = ['PENDING', 'CONFIRMED', 'FAILED', 'EXPIRED'] as const;
const METHOD_LABELS = { CASH: 'Cash', BANK_TRANSFER: 'Bank transfer', SEPAY: 'SePay' } as const;

const InvoicesTab: React.FC<{ contractId?: string }> = ({ contractId }) => {
  const [filters, setFilters] = useState<InvoiceFilters>({ pageNumber: 1, contractId });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data, isLoading, error, refetch } = useInvoices('t', filters);

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_440px]">
      <div className="min-w-0 overflow-x-auto">
        <InvoiceFilterBar filters={filters} onChange={setFilters} />
        <InvoiceTable
          invoices={data?.items}
          showOrganization
          filters={filters}
          onFilters={setFilters}
          selectedId={selectedId}
          onOpen={(invoice) => setSelectedId(invoice.id)}
          loading={isLoading}
          error={error}
          onRetry={() => void refetch()}
          pageInfo={pageInfoOf(data)}
          footer={
            data && data.totalPages > 1 ? (
              <Pagination
                pageNumber={data.pageNumber}
                totalPages={data.totalPages}
                totalItems={data.totalCount}
                pageSize={data.pageSize}
                onPage={(pageNumber) => setFilters({ ...filters, pageNumber })}
              />
            ) : undefined
          }
        />
      </div>
      {selectedId ? (
        <InvoiceDetailView
          key={selectedId}
          invoiceId={selectedId}
          contractPath={(id) => `/t/contracts/${id}`}
          canRecordCounter
        />
      ) : (
        <p className="text-sm text-ink-muted">Open an invoice to see its lines and payments.</p>
      )}
    </div>
  );
};

const statusLabel = (status: string) => status.charAt(0) + status.slice(1).toLowerCase();

// The payments of billing api-design 14 on CollectionView (chapter 06 §9, D-096): the status in the
// Show filter queries the server; the search narrows the loaded page by reference and method.
const PaymentsTab: React.FC = () => {
  const [filters, setFilters] = useState<PaymentFilters>({ pageNumber: 1 });
  const { data, isLoading, error, refetch } = usePayments(filters);
  const [text, setText] = useState('');
  const rows = data?.items.filter((payment) =>
    matchesText(text, payment.reference, METHOD_LABELS[payment.method]),
  );
  const fields: CollectionField<PaymentRow>[] = [
    {
      key: 'method',
      label: 'Method',
      render: (payment) => (
        <>
          {METHOD_LABELS[payment.method]}
          {payment.isSandbox && (
            <Badge tone="attention" className="ml-2">
              SANDBOX
            </Badge>
          )}
        </>
      ),
      compact: true,
    },
    {
      key: 'amount',
      label: 'Amount',
      align: 'end',
      render: (payment) => formatVnd(payment.amountVnd),
      compact: true,
    },
    {
      key: 'status',
      label: 'Status',
      render: (payment) => statusLabel(payment.status),
      compact: true,
    },
    {
      key: 'confirmed',
      label: 'Confirmed',
      render: (payment) => (payment.confirmedAt ? formatDateTime(payment.confirmedAt) : 'Not yet'),
      hideWithPane: true,
    },
  ];

  return (
    <CollectionView<PaymentRow>
      label="Payments"
      items={rows}
      loading={isLoading}
      error={error ? <ErrorState error={error} onRetry={() => void refetch()} /> : undefined}
      itemId={(payment) => payment.id}
      itemName={(payment) => payment.reference}
      itemTitle={(payment) => (
        <span className="font-mono font-semibold text-ink">{payment.reference}</span>
      )}
      fields={fields}
      noun={{ one: 'payment', other: 'payments' }}
      search={{ label: 'Search by reference or method' }}
      filters={[
        { key: '', label: 'Every status' },
        ...PAYMENT_STATUSES.map((status) => ({ key: status, label: statusLabel(status) })),
      ]}
      query={{ search: text, filter: filters.status ?? '', sort: null }}
      onQueryChange={(next) => {
        setText(next.search);
        if ((next.filter || undefined) !== filters.status)
          setFilters({
            status: (next.filter || undefined) as PaymentFilters['status'],
            pageNumber: 1,
          });
      }}
      pageInfo={pageInfoOf(data)}
      emptyState={{ title: 'No payments recorded.' }}
      footer={
        data && data.totalPages > 1 ? (
          <Pagination
            pageNumber={data.pageNumber}
            totalPages={data.totalPages}
            totalItems={data.totalCount}
            pageSize={data.pageSize}
            onPage={(pageNumber) => setFilters({ ...filters, pageNumber })}
          />
        ) : undefined
      }
    />
  );
};

// /t/billing, TrekLink Staff and Admin: the invoice tab of screen 6.1 with the detail in a side
// panel and Record counter payment (6.3), and the payments tab (billing api-design 14).
export const BillingPage: React.FC = () => {
  const [params] = useSearchParams();
  const [tab, setTab] = useState<'invoices' | 'payments'>('invoices');

  return (
    <section aria-labelledby="billing-title">
      <PageTitle id="billing-title" title="Invoices and payments" />
      <div role="tablist" aria-label="Billing" className="mb-4 flex gap-2">
        {(['invoices', 'payments'] as const).map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            onClick={() => setTab(name)}
            className={TAB(tab === name)}
          >
            {name === 'invoices' ? 'Invoices' : 'Payments'}
          </button>
        ))}
      </div>
      {tab === 'invoices' ? (
        <InvoicesTab contractId={params.get('contractId') ?? undefined} />
      ) : (
        <PaymentsTab />
      )}
    </section>
  );
};
