import React, { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useInvoices, type InvoiceFilters } from '../entities/billing/api';
import { Empty, ErrorState, Loading, PageTitle, Pager } from '../shared/ui/bits';
import { LINK } from '../shared/ui/styles';
import { InvoiceDetailView } from '../widgets/InvoiceDetail/InvoiceDetailView';
import { InvoiceTable } from '../widgets/InvoiceDetail/InvoiceTable';

// The one filter of screen 6.1 that lives outside the table: the contract a contract page linked
// from, with a way back to every contract. Status and overdue sit in the table's filter row.
export const InvoiceFilterBar: React.FC<{
  filters: InvoiceFilters;
  onChange: (filters: InvoiceFilters) => void;
}> = ({ filters, onChange }) =>
  filters.contractId ? (
    <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-slate-700">
      Showing one contract.
      <button
        type="button"
        className="font-semibold text-blue-700"
        onClick={() => onChange({ ...filters, contractId: undefined, pageNumber: 1 })}
      >
        Show every contract
      </button>
    </div>
  ) : null;

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
      {data && data.items.length === 0 && !filtered && (
        <Empty>No invoices yet. Invoices appear when TrekLink approves a contract.</Empty>
      )}
      {data && (data.items.length > 0 || filtered) && (
        <>
          <InvoiceTable
            invoices={data.items}
            showOrganization={false}
            filters={filters}
            onFilters={setFilters}
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
