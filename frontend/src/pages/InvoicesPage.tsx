import React, { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  INVOICE_STATUS_LABELS,
  useInvoices,
  type InvoiceFilters,
  type InvoiceStatus,
} from '../entities/billing/api';
import { Empty, ErrorState, Loading, PageTitle, Pager } from '../shared/ui/bits';
import { INPUT, LINK } from '../shared/ui/styles';
import { InvoiceDetailView } from '../widgets/InvoiceDetail/InvoiceDetailView';
import { InvoiceTable } from '../widgets/InvoiceDetail/InvoiceTable';

const STATUSES = Object.keys(INVOICE_STATUS_LABELS) as InvoiceStatus[];

// The filter row of screen 6.1: status and overdue only; a contract filter comes from the link on
// the contract page.
export const InvoiceFilterBar: React.FC<{
  filters: InvoiceFilters;
  onChange: (filters: InvoiceFilters) => void;
}> = ({ filters, onChange }) => (
  <div className="mb-4 flex flex-wrap items-center gap-3">
    <select
      aria-label="Filter by status"
      className={INPUT}
      value={filters.status ?? ''}
      onChange={(event) =>
        onChange({
          ...filters,
          status: (event.target.value || undefined) as InvoiceStatus | undefined,
          pageNumber: 1,
        })
      }
    >
      <option value="">All statuses</option>
      {STATUSES.map((status) => (
        <option key={status} value={status}>
          {INVOICE_STATUS_LABELS[status]}
        </option>
      ))}
    </select>
    <label className="flex items-center gap-2 text-sm font-semibold">
      <input
        type="checkbox"
        checked={filters.overdue === true}
        onChange={(event) =>
          onChange({ ...filters, overdue: event.target.checked || undefined, pageNumber: 1 })
        }
      />
      Overdue only
    </label>
    {filters.contractId && (
      <button
        type="button"
        className="text-sm font-semibold text-blue-700"
        onClick={() => onChange({ ...filters, contractId: undefined, pageNumber: 1 })}
      >
        Show every contract
      </button>
    )}
  </div>
);

// /o/invoices, the Org Manager's invoice list of screen 6.1 (billing api-design 08).
export const InvoicesPage: React.FC = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [filters, setFilters] = useState<InvoiceFilters>({
    pageNumber: 1,
    contractId: params.get('contractId') ?? undefined,
  });
  const { data, isLoading, error, refetch } = useInvoices('o', filters);
  const filtered = filters.status !== undefined || filters.overdue !== undefined;

  return (
    <section aria-labelledby="invoices-title">
      <PageTitle id="invoices-title" title="Invoices" />
      <InvoiceFilterBar filters={filters} onChange={setFilters} />
      {isLoading && <Loading />}
      {error && <ErrorState error={error} onRetry={() => void refetch()} />}
      {data && data.items.length === 0 && (
        <Empty>
          {filtered
            ? 'No results match your filters.'
            : 'No invoices yet. Invoices appear when TrekLink approves a contract.'}
        </Empty>
      )}
      {data && data.items.length > 0 && (
        <>
          <InvoiceTable
            invoices={data.items}
            showOrganization={false}
            onOpen={(invoice) => navigate(`/o/invoices/${invoice.id}`)}
          />
          <Pager
            pageNumber={data.pageNumber}
            totalPages={data.totalPages}
            onPage={(pageNumber) => setFilters({ ...filters, pageNumber })}
          />
        </>
      )}
    </section>
  );
};

// /o/invoices/:id, the invoice detail of screen 6.1 (billing api-design 09).
export const InvoiceDetailPage: React.FC = () => {
  const { id = '' } = useParams();
  return (
    <section aria-label="Invoice">
      <Link to="/o/invoices" className={`${LINK} mb-4 inline-block text-sm`}>
        Back to invoices
      </Link>
      <InvoiceDetailView
        invoiceId={id}
        contractPath={(contractId) => `/o/contracts/${contractId}`}
        canRecordCounter={false}
      />
    </section>
  );
};
