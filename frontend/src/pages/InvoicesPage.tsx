import React, { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useInvoices, useVariantName, type InvoiceFilters } from '../entities/billing/api';
import { addDays, isDay, lastDaysPeriod, monthPeriod, type Period } from '../entities/report/model';
import { Button, Field, Input } from '../shared/ui';
import { PageTitle } from '../shared/ui/bits';
import { Pagination } from '../shared/ui/DataTable';
import { InvoiceDetailView } from '../widgets/InvoiceDetail/InvoiceDetailView';
import { InvoiceTable } from '../widgets/InvoiceDetail/InvoiceTable';
import { invoiceFiltersFromParams } from '../widgets/InvoiceDetail/invoice-list';
import { InvoiceTotals } from '../widgets/InvoiceDetail/InvoiceTotals';
import { pageInfoOf } from '../shared/ui/collection-view';

// The filters of screen 6.1 that live outside the table: the contract a contract page linked from, the
// hardware variant a report row linked from, and the period (lines due from the first day to the day
// after the last, as the revenue report takes it, #501). Status and overdue sit in the table toolbar.
export const InvoiceFilterBar: React.FC<{
  filters: InvoiceFilters;
  onChange: (filters: InvoiceFilters) => void;
}> = ({ filters, onChange }) => {
  const variantName = useVariantName();
  const [from, setFrom] = useState(filters.from ?? '');
  const [lastDay, setLastDay] = useState(filters.to ? addDays(filters.to, -1) : '');
  const [message, setMessage] = useState<string | null>(null);
  // A link or a preset changes the period from outside; the fields follow it.
  const periodKey = `${filters.from ?? ''}/${filters.to ?? ''}`;
  const [shown, setShown] = useState(periodKey);
  if (shown !== periodKey) {
    setShown(periodKey);
    setFrom(filters.from ?? '');
    setLastDay(filters.to ? addDays(filters.to, -1) : '');
    setMessage(null);
  }
  const setPeriod = (period: Period | null) =>
    onChange({ ...filters, from: period?.from, to: period?.to, pageNumber: 1 });
  const apply = (event: React.FormEvent) => {
    event.preventDefault();
    if (from === '' && lastDay === '') return setPeriod(null);
    if (!isDay(from) || !isDay(lastDay) || lastDay < from) {
      setMessage('Choose a first day and a last day that is not before it.');
      return;
    }
    setMessage(null);
    setPeriod({ from, to: addDays(lastDay, 1) });
  };
  return (
    <div className="mb-4 flex flex-col gap-3">
      {filters.contractId ? (
        <div className="flex flex-wrap items-center gap-3 text-sm text-ink-muted">
          Showing one contract.
          <button
            type="button"
            className="font-semibold text-brand"
            onClick={() => onChange({ ...filters, contractId: undefined, pageNumber: 1 })}
          >
            Show every contract
          </button>
        </div>
      ) : null}
      {filters.hardwareVariantId ? (
        <div className="flex flex-wrap items-center gap-3 text-sm text-ink-muted">
          Showing variant {variantName({ id: filters.hardwareVariantId, code: null })}.
          <button
            type="button"
            className="font-semibold text-brand"
            onClick={() => onChange({ ...filters, hardwareVariantId: undefined, pageNumber: 1 })}
          >
            Show every variant
          </button>
        </div>
      ) : null}
      <form onSubmit={apply} aria-label="Invoice period" className="flex flex-wrap items-end gap-3">
        <Field id="invoices-from" label="Due from">
          <Input
            id="invoices-from"
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </Field>
        <Field id="invoices-to" label="Due to" error={message ?? undefined}>
          <Input
            id="invoices-to"
            type="date"
            value={lastDay}
            onChange={(event) => setLastDay(event.target.value)}
          />
        </Field>
        <Button type="submit" variant="primary">
          Apply
        </Button>
        <Button type="button" variant="ghost" onClick={() => setPeriod(monthPeriod(new Date()))}>
          This month
        </Button>
        <Button type="button" variant="ghost" onClick={() => setPeriod(monthPeriod(new Date(), -1))}>
          Last month
        </Button>
        <Button type="button" variant="ghost" onClick={() => setPeriod(lastDaysPeriod(new Date(), 30))}>
          Last 30 days
        </Button>
        {filters.from ? (
          <Button type="button" variant="ghost" onClick={() => setPeriod(null)}>
            Any period
          </Button>
        ) : null}
      </form>
    </div>
  );
};

// /o/invoices, the Org Manager's invoice list of screen 6.1 (billing api-design 08).
export const InvoicesPage: React.FC = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [filters, setFilters] = useState<InvoiceFilters>(() => invoiceFiltersFromParams(params));
  const { data, isLoading, error, refetch } = useInvoices('o', filters);

  return (
    <section aria-labelledby="invoices-title" data-fit-page="" className="flex min-h-0 flex-1 flex-col">
      <PageTitle id="invoices-title" title="Invoices" />
      <InvoiceFilterBar filters={filters} onChange={setFilters} />
      <InvoiceTotals totals={data?.totals} filters={filters} />
      <InvoiceTable
        invoices={data?.items}
        showOrganization={false}
        filters={filters}
        onFilters={setFilters}
        onOpen={(invoice) => navigate(`/o/invoices/${invoice.id}`)}
        loading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        emptyTitle="No invoices yet. Invoices appear when TrekLink approves a contract."
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
    </section>
  );
};

// /o/invoices/:id, the invoice detail of screen 6.1 (billing api-design 09). The way back is the shell's
// breadcrumb (its back link on a phone), so the page spends no line on a second one (W21).
export const InvoiceDetailPage: React.FC = () => {
  const { id = '' } = useParams();
  return (
    <section aria-label="Invoice" data-fit-page="" className="flex min-h-0 flex-1 flex-col">
      <InvoiceDetailView
        invoiceId={id}
        contractPath={(contractId) => `/o/contracts/${contractId}`}
        canRecordCounter={false}
        canPayOnline
        asPageTitle
      />
    </section>
  );
};
