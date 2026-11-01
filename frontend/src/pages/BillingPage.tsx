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
import { Button } from '../shared/ui/Button';
import { DataTable, Pagination, type Column } from '../shared/ui/DataTable';
import { Select } from '../shared/ui/Field';
import { Toolbar, ToolbarSearch } from '../shared/ui/Toolbar';
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

const PaymentsTab: React.FC = () => {
  const [filters, setFilters] = useState<PaymentFilters>({ pageNumber: 1 });
  const { data, isLoading, error, refetch } = usePayments(filters);
  const [reference, setReference] = useState('');
  const [method, setMethod] = useState('');
  const filtered = filters.status !== undefined || reference !== '' || method !== '';
  const clear = () => {
    setReference('');
    setMethod('');
    setFilters({ pageNumber: 1 });
  };
  const rows = data?.items.filter(
    (payment) => matchesText(reference, payment.reference) && (method === '' || payment.method === method),
  );
  const columns: Column<PaymentRow>[] = [
    { key: 'reference', header: 'Reference', cell: (payment) => <span className="font-mono">{payment.reference}</span> },
    {
      key: 'method',
      header: 'Method',
      cell: (payment) => (
        <>
          {METHOD_LABELS[payment.method]}
          {payment.isSandbox && (
            <Badge tone="attention" className="ml-2">
              SANDBOX
            </Badge>
          )}
        </>
      ),
    },
    { key: 'amount', header: 'Amount', align: 'end', cell: (payment) => formatVnd(payment.amountVnd) },
    { key: 'status', header: 'Status', cell: (payment) => payment.status.charAt(0) + payment.status.slice(1).toLowerCase() },
    { key: 'confirmed', header: 'Confirmed', cell: (payment) => (payment.confirmedAt ? formatDateTime(payment.confirmedAt) : 'Not yet') },
  ];

  return (
    <div>
      <Toolbar
        label="Payment filters"
        start={
          <>
            <ToolbarSearch id="payment-reference" label="Search by reference" value={reference} onChange={setReference} />
            <span className="w-44">
              <Select aria-label="Method" value={method} onChange={(event) => setMethod(event.target.value)}>
                <option value="">Every method</option>
                {Object.entries(METHOD_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </span>
            <span className="w-40">
              <Select
                aria-label="Status"
                value={filters.status ?? ''}
                onChange={(event) =>
                  setFilters({ ...filters, status: (event.target.value || undefined) as PaymentFilters['status'], pageNumber: 1 })
                }
              >
                <option value="">Every status</option>
                {PAYMENT_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status.charAt(0) + status.slice(1).toLowerCase()}
                  </option>
                ))}
              </Select>
            </span>
            {filtered && (
              <Button variant="ghost" onClick={clear}>
                Clear filters
              </Button>
            )}
          </>
        }
      />
      <DataTable<PaymentRow>
        caption="Payments"
        columns={columns}
        rows={rows}
        rowId={(payment) => payment.id}
        rowLabel={(payment) => payment.reference}
        loading={isLoading}
        error={error ? <ErrorState error={error} onRetry={() => void refetch()} /> : undefined}
        empty={
          filtered
            ? { title: 'No results match your filters.', action: <Button onClick={clear}>Clear filters</Button> }
            : { title: 'No payments recorded.' }
        }
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
