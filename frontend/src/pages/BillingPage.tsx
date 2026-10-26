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
import { INPUT, TAB } from '../shared/ui/styles';
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
        {data && data.items.length === 0 && <Empty>No results match your filters.</Empty>}
        {data && data.items.length > 0 && (
          <>
            <InvoiceTable
              invoices={data.items}
              showOrganization
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
        <p className="text-sm text-slate-600">Open an invoice to see its lines and payments.</p>
      )}
    </div>
  );
};

const PaymentsTab: React.FC = () => {
  const [filters, setFilters] = useState<PaymentFilters>({ pageNumber: 1 });
  const { data, isLoading, error, refetch } = usePayments(filters);

  return (
    <div>
      <div className="mb-4">
        <select
          aria-label="Filter by status"
          className={INPUT}
          value={filters.status ?? ''}
          onChange={(event) =>
            setFilters({
              ...filters,
              status: (event.target.value || undefined) as PaymentFilters['status'],
              pageNumber: 1,
            })
          }
        >
          <option value="">All statuses</option>
          {PAYMENT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status.charAt(0) + status.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
      </div>
      {isLoading && <Loading />}
      {error && <ErrorState error={error} onRetry={() => void refetch()} />}
      {data && data.items.length === 0 && (
        <Empty>{filters.status ? 'No results match your filters.' : 'No payments recorded.'}</Empty>
      )}
      {data && data.items.length > 0 && (
        <>
          <table className="w-full overflow-hidden rounded-xl border border-slate-200 bg-white text-sm shadow-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-3 py-3">Reference</th>
                <th className="px-3 py-3">Method</th>
                <th className="px-3 py-3 text-right">Amount</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Confirmed</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((payment) => (
                <tr key={payment.id} className="border-t border-slate-200">
                  <td className="px-3 py-3 font-mono">{payment.reference}</td>
                  <td className="px-3 py-3">
                    {METHOD_LABELS[payment.method]}
                    {payment.isSandbox && (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-bold text-amber-900">
                        SANDBOX
                      </span>
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
