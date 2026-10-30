import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  usePayments,
  useInvoices,
  type InvoiceFilters,
  type PaymentFilters,
} from '../entities/billing/api';
import { formatDateTime, formatVnd } from '../shared/lib/format';
import { Empty, ErrorState, Loading, PageTitle, Pager } from '../shared/ui/bits';
import { Badge } from '../shared/ui/Badge';
import { TAB } from '../shared/ui/styles';
import { matchesText } from '../shared/lib/filter';
import { FilterRow, NoMatchRow, type FilterField } from '../shared/ui/TableFilters';
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
    <div className="grid gap-5 xl:grid-cols-[1fr_440px]">
      <div>
        <InvoiceFilterBar filters={filters} onChange={setFilters} />
        {isLoading && <Loading />}
        {error && <ErrorState error={error} onRetry={() => void refetch()} />}
        {data && (
          <>
            <InvoiceTable
              invoices={data.items}
              showOrganization
              filters={filters}
              onFilters={setFilters}
              selectedId={selectedId}
              onOpen={(invoice) => setSelectedId(invoice.id)}
            />
            <Pager
              pageNumber={data.pageNumber}
              totalPages={data.totalPages}
              onPage={(pageNumber) => setFilters({ ...filters, pageNumber })}
            />
          </>
        )}
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
  const rows =
    data?.items.filter(
      (payment) =>
        matchesText(reference, payment.reference) && (method === '' || payment.method === method),
    ) ?? [];
  const columns: (FilterField | null)[] = [
    { label: 'reference', kind: 'text', value: reference, onChange: setReference },
    {
      label: 'method',
      kind: 'select',
      value: method,
      onChange: setMethod,
      options: Object.entries(METHOD_LABELS).map(([value, label]) => ({ value, label })),
    },
    null,
    {
      label: 'status',
      kind: 'select',
      value: filters.status ?? '',
      options: PAYMENT_STATUSES.map((status) => ({
        value: status,
        label: status.charAt(0) + status.slice(1).toLowerCase(),
      })),
      onChange: (value) =>
        setFilters({
          ...filters,
          status: (value || undefined) as PaymentFilters['status'],
          pageNumber: 1,
        }),
    },
    null,
  ];

  return (
    <div>
      {isLoading && <Loading />}
      {error && <ErrorState error={error} onRetry={() => void refetch()} />}
      {data && data.items.length === 0 && !filtered && <Empty>No payments recorded.</Empty>}
      {data && (data.items.length > 0 || filtered) && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full overflow-hidden rounded-xl border border-line bg-surface text-sm shadow-sm">
              <thead className="bg-sunken text-left text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-3 py-3">Reference</th>
                  <th className="px-3 py-3">Method</th>
                  <th className="px-3 py-3 text-right">Amount</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Confirmed</th>
                </tr>
                <FilterRow columns={columns} onClear={clear} />
              </thead>
              <tbody>
                {rows.length === 0 && <NoMatchRow colSpan={5} onClear={clear} />}
                {rows.map((payment) => (
                  <tr key={payment.id} className="border-t border-line">
                    <td className="px-3 py-3 font-mono">{payment.reference}</td>
                    <td className="px-3 py-3">
                      {METHOD_LABELS[payment.method]}
                      {payment.isSandbox && (
                        <Badge tone="attention" className="ml-2">
                          SANDBOX
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right">{formatVnd(payment.amountVnd)}</td>
                    <td className="px-3 py-3">{payment.status.toLowerCase()}</td>
                    <td className="px-3 py-3">
                      {payment.confirmedAt ? formatDateTime(payment.confirmedAt) : 'Not yet'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager
            pageNumber={data.pageNumber}
            totalPages={data.totalPages}
            onPage={(pageNumber) => setFilters({ ...filters, pageNumber })}
          />
        </>
      )}
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
      <PageTitle id="billing-title" title="Billing" />
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
