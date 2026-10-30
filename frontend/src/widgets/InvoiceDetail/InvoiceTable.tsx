import React, { useState } from 'react';
import {
  INVOICE_STATUS_LABELS,
  INVOICE_TONES,
  type Invoice,
  type InvoiceFilters,
  type InvoiceStatus,
} from '../../entities/billing/api';
import { formatDate, formatVnd } from '../../shared/lib/format';
import { Badge } from '../../shared/ui/bits';
import { matchesText } from '../../shared/lib/filter';
import { FilterBar, FilterRow, NoMatchRow, type FilterField } from '../../shared/ui/TableFilters';

const STATUSES = Object.keys(INVOICE_STATUS_LABELS) as InvoiceStatus[];

// The invoice list of screen 6.1 as rows on a wide screen and cards on a narrow one, with its filters
// inside the table: status and "overdue only" query the server (billing api-design 08), number,
// organization and contract narrow the loaded page. The TrekLink view adds the organization column.
export const InvoiceTable: React.FC<{
  invoices: Invoice[];
  showOrganization: boolean;
  filters: InvoiceFilters;
  onFilters: (filters: InvoiceFilters) => void;
  selectedId?: string | null;
  onOpen: (invoice: Invoice) => void;
}> = ({ invoices, showOrganization, filters, onFilters, selectedId, onOpen }) => {
  const [find, setFind] = useState({ number: '', organization: '', contract: '' });
  const set = (key: keyof typeof find) => (value: string) =>
    setFind((current) => ({ ...current, [key]: value }));
  const clear = () => {
    setFind({ number: '', organization: '', contract: '' });
    onFilters({ pageNumber: 1, contractId: filters.contractId });
  };
  const rows = invoices.filter(
    (invoice) =>
      matchesText(find.number, invoice.number) &&
      matchesText(find.organization, invoice.organization.code) &&
      matchesText(find.contract, invoice.contract.code),
  );
  const fields: Record<'number' | 'organization' | 'contract' | 'status' | 'due', FilterField> = {
    number: { label: 'number', kind: 'text', value: find.number, onChange: set('number') },
    organization: {
      label: 'organization',
      kind: 'text',
      value: find.organization,
      onChange: set('organization'),
    },
    contract: { label: 'contract', kind: 'text', value: find.contract, onChange: set('contract') },
    status: {
      label: 'status',
      kind: 'select',
      value: filters.status ?? '',
      options: STATUSES.map((status) => ({ value: status, label: INVOICE_STATUS_LABELS[status] })),
      onChange: (value) =>
        onFilters({
          ...filters,
          status: (value || undefined) as InvoiceStatus | undefined,
          pageNumber: 1,
        }),
    },
    due: {
      label: 'overdue',
      kind: 'select',
      value: filters.overdue ? 'OVERDUE' : '',
      options: [{ value: 'OVERDUE', label: 'Overdue only' }],
      onChange: (value) =>
        onFilters({ ...filters, overdue: value === 'OVERDUE' || undefined, pageNumber: 1 }),
    },
  };
  const columns = [
    fields.number,
    ...(showOrganization ? [fields.organization] : []),
    fields.contract,
    null,
    fields.status,
    null,
    null,
    fields.due,
  ];

  return (
    <>
      <FilterBar
        className="mb-3 md:hidden"
        fields={[
          fields.number,
          ...(showOrganization ? [fields.organization] : []),
          fields.contract,
          fields.status,
          fields.due,
        ]}
        onClear={clear}
      />
      <ul className="flex flex-col gap-2 md:hidden">
        {rows.length === 0 && <li className="text-ink-muted">No rows match these filters.</li>}
        {rows.map((invoice) => (
          <li key={invoice.id}>
            <button
              type="button"
              onClick={() => onOpen(invoice)}
              className="w-full rounded-xl border border-line bg-surface p-4 text-left"
            >
              <span className="flex justify-between">
                <span className="font-semibold">{invoice.number}</span>
                <Badge tone={INVOICE_TONES[invoice.status]}>
                  {INVOICE_STATUS_LABELS[invoice.status]}
                </Badge>
              </span>
              <span className="block text-sm text-ink-muted">
                {invoice.contract.code}, {formatVnd(invoice.totalVnd)}, paid{' '}
                {formatVnd(invoice.paidVnd)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <table className="hidden w-full overflow-hidden rounded-xl border border-line bg-surface text-sm shadow-sm md:table">
        <thead className="bg-sunken text-left text-xs uppercase tracking-wide text-ink-muted">
          <tr>
            <th className="px-3 py-3">Number</th>
            {showOrganization && <th className="px-3 py-3">Organization</th>}
            <th className="px-3 py-3">Contract</th>
            <th className="px-3 py-3">Kind</th>
            <th className="px-3 py-3">Status</th>
            <th className="px-3 py-3 text-right">Total</th>
            <th className="px-3 py-3 text-right">Paid</th>
            <th className="px-3 py-3">Issued</th>
          </tr>
          <FilterRow columns={columns} onClear={clear} />
        </thead>
        <tbody>
          {rows.length === 0 && <NoMatchRow colSpan={columns.length} onClear={clear} />}
          {rows.map((invoice) => (
            <tr
              key={invoice.id}
              className={`border-t border-line ${invoice.id === selectedId ? 'bg-chrome' : ''}`}
            >
              <td className="px-3 py-3">
                <button
                  type="button"
                  className="font-semibold text-brand hover:underline"
                  onClick={() => onOpen(invoice)}
                >
                  {invoice.number}
                </button>
              </td>
              {showOrganization && <td className="px-3 py-3">{invoice.organization.code}</td>}
              <td className="px-3 py-3">{invoice.contract.code}</td>
              <td className="px-3 py-3">
                {invoice.term ? `Term ${invoice.term.seq}` : invoice.kind.replace('_', ' ')}
              </td>
              <td className="px-3 py-3">
                <Badge tone={INVOICE_TONES[invoice.status]}>
                  {INVOICE_STATUS_LABELS[invoice.status]}
                </Badge>
              </td>
              <td className="px-3 py-3 text-right">{formatVnd(invoice.totalVnd)}</td>
              <td className="px-3 py-3 text-right">{formatVnd(invoice.paidVnd)}</td>
              <td className="px-3 py-3">{formatDate(invoice.issuedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
};
