import React, { useState } from 'react';
import {
  INVOICE_STATUS_LABELS,
  INVOICE_TONES,
  type Invoice,
  type InvoiceFilters,
  type InvoiceStatus,
} from '../../entities/billing/api';
import { formatDate, formatVnd } from '../../shared/lib/format';
import { matchesText } from '../../shared/lib/filter';
import { Badge, ErrorState } from '../../shared/ui/bits';
import { Button } from '../../shared/ui/Button';
import { Checkbox, Select } from '../../shared/ui/Field';
import { DataTable, type Column } from '../../shared/ui/DataTable';
import { Toolbar, ToolbarSearch } from '../../shared/ui/Toolbar';

const STATUSES = Object.keys(INVOICE_STATUS_LABELS) as InvoiceStatus[];

const kindOf = (invoice: Invoice) => (invoice.term ? `Term ${invoice.term.seq}` : invoice.kind.replace('_', ' '));

// The invoice list of screen 6.1 on the shared DataTable (W29): status and "overdue only" query the
// server (billing api-design 08); the search narrows the loaded page by number, organization and
// contract. The TrekLink view adds the organization column. A row opens through its number button.
export const InvoiceTable: React.FC<{
  invoices: Invoice[] | undefined;
  showOrganization: boolean;
  filters: InvoiceFilters;
  onFilters: (filters: InvoiceFilters) => void;
  selectedId?: string | null;
  onOpen: (invoice: Invoice) => void;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** Shown when nothing is filtered and the list is empty. */
  emptyTitle?: string;
  footer?: React.ReactNode;
}> = ({ invoices, showOrganization, filters, onFilters, selectedId, onOpen, loading, error, onRetry, emptyTitle, footer }) => {
  const [text, setText] = useState('');
  const filtered = text !== '' || filters.status !== undefined || filters.overdue !== undefined;
  const clear = () => {
    setText('');
    onFilters({ pageNumber: 1, contractId: filters.contractId });
  };
  const rows = invoices?.filter((invoice) =>
    matchesText(text, invoice.number, showOrganization ? invoice.organization.code ?? undefined : undefined, invoice.contract.code ?? undefined),
  );

  const columns: Column<Invoice>[] = [
    { key: 'number', header: 'Number', cell: (invoice) => invoice.number },
    ...(showOrganization
      ? [{ key: 'organization', header: 'Organization', cell: (invoice: Invoice) => invoice.organization.code }]
      : []),
    { key: 'contract', header: 'Contract', cell: (invoice) => invoice.contract.code },
    { key: 'kind', header: 'Kind', cell: kindOf, hideOnMobile: true },
    {
      key: 'status',
      header: 'Status',
      cell: (invoice) => <Badge tone={INVOICE_TONES[invoice.status]}>{INVOICE_STATUS_LABELS[invoice.status]}</Badge>,
    },
    { key: 'total', header: 'Total', align: 'end', cell: (invoice) => formatVnd(invoice.totalVnd) },
    { key: 'paid', header: 'Paid', align: 'end', cell: (invoice) => formatVnd(invoice.paidVnd) },
    { key: 'issued', header: 'Issued', cell: (invoice) => formatDate(invoice.issuedAt), hideOnMobile: true },
  ];

  return (
    <>
      <Toolbar
        label="Invoice filters"
        start={
          <>
            <ToolbarSearch
              id="invoice-search"
              label={showOrganization ? 'Search by number, organization or contract' : 'Search by number or contract'}
              placeholder={showOrganization ? 'Number, organization or contract' : 'Number or contract'}
              value={text}
              onChange={setText}
            />
            <span className="w-44">
              <Select
                aria-label="Status"
                value={filters.status ?? ''}
                onChange={(event) =>
                  onFilters({ ...filters, status: (event.target.value || undefined) as InvoiceStatus | undefined, pageNumber: 1 })
                }
              >
                <option value="">Every status</option>
                {STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {INVOICE_STATUS_LABELS[status]}
                  </option>
                ))}
              </Select>
            </span>
            <Checkbox
              label="Overdue only"
              checked={filters.overdue === true}
              onChange={(event) => onFilters({ ...filters, overdue: event.target.checked || undefined, pageNumber: 1 })}
            />
            {filtered && (
              <Button variant="ghost" onClick={clear}>
                Clear filters
              </Button>
            )}
          </>
        }
      />
      <DataTable<Invoice>
        caption="Invoices"
        columns={columns}
        rows={rows}
        rowId={(invoice) => invoice.id}
        rowLabel={(invoice) => invoice.number}
        loading={loading}
        error={error ? <ErrorState error={error} onRetry={onRetry} /> : undefined}
        empty={
          filtered
            ? { title: 'No results match your filters.', action: <Button onClick={clear}>Clear filters</Button> }
            : { title: emptyTitle ?? 'No invoices yet.' }
        }
        activeRowId={selectedId ?? undefined}
        onRowActivate={onOpen}
        renderCard={(invoice) => (
          <button type="button" onClick={() => onOpen(invoice)} className="w-full text-left">
            <span className="flex justify-between">
              <span className="font-semibold">{invoice.number}</span>
              <Badge tone={INVOICE_TONES[invoice.status]}>{INVOICE_STATUS_LABELS[invoice.status]}</Badge>
            </span>
            <span className="block text-sm text-ink-muted">
              {invoice.contract.code}, {formatVnd(invoice.totalVnd)}, paid {formatVnd(invoice.paidVnd)}
            </span>
          </button>
        )}
        footer={footer}
      />
    </>
  );
};
