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
import {
  CollectionView,
  type CollectionField,
  type CollectionPageInfo,
} from '../../shared/ui/collection-view';
import { LINK } from '../../shared/ui/styles';

const STATUSES = Object.keys(INVOICE_STATUS_LABELS) as InvoiceStatus[];
const OVERDUE = 'OVERDUE';

const kindOf = (invoice: Invoice) =>
  invoice.term ? `Term ${invoice.term.seq}` : invoice.kind.replace('_', ' ');

// Show holds two server filters that combine (billing api-design 08 `status` and `overdue`): one
// status or every status, and overdue only or any (review of treklink-web#350).

// The invoice list of screen 6.1 on CollectionView (chapter 06 §9, D-096): status and overdue in the
// Show filter query the server (billing api-design 08); the search narrows the loaded page by number,
// organization and contract. The TrekLink view adds the organization column. The number and Show
// details open the invoice, the screen's own invoice view.
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
  pageInfo?: CollectionPageInfo;
  footer?: React.ReactNode;
}> = ({
  invoices,
  showOrganization,
  filters,
  onFilters,
  selectedId,
  onOpen,
  loading,
  error,
  onRetry,
  emptyTitle,
  pageInfo,
  footer,
}) => {
  const [text, setText] = useState('');
  const rows = invoices?.filter((invoice) =>
    matchesText(
      text,
      invoice.number,
      showOrganization ? (invoice.organization.code ?? undefined) : undefined,
      invoice.contract.code ?? undefined,
    ),
  );

  const fields: CollectionField<Invoice>[] = [
    ...(showOrganization
      ? [
          {
            key: 'organization',
            label: 'Organization',
            render: (invoice: Invoice) => invoice.organization.code,
            compact: true,
          },
        ]
      : []),
    {
      key: 'contract',
      label: 'Contract',
      render: (invoice) => invoice.contract.code,
      compact: true,
    },
    { key: 'kind', label: 'Kind', render: kindOf, hideWithPane: true },
    {
      key: 'status',
      label: 'Status',
      render: (invoice) => (
        <Badge tone={INVOICE_TONES[invoice.status]}>{INVOICE_STATUS_LABELS[invoice.status]}</Badge>
      ),
      compact: true,
    },
    {
      key: 'total',
      label: 'Total',
      align: 'end',
      render: (invoice) => formatVnd(invoice.totalVnd),
      compact: true,
    },
    { key: 'paid', label: 'Paid', align: 'end', render: (invoice) => formatVnd(invoice.paidVnd) },
    {
      key: 'issued',
      label: 'Issued',
      render: (invoice) => formatDate(invoice.issuedAt),
      hideWithPane: true,
    },
  ];

  return (
    <CollectionView<Invoice>
      label="Invoices"
      items={rows}
      loading={loading}
      error={error ? <ErrorState error={error} onRetry={onRetry} /> : undefined}
      itemId={(invoice) => invoice.id}
      itemName={(invoice) => invoice.number}
      itemTitle={(invoice) => (
        <button
          type="button"
          aria-pressed={selectedId !== undefined ? selectedId === invoice.id : undefined}
          onClick={() => onOpen(invoice)}
          className={`${LINK} inline-flex min-h-6 items-center`}
        >
          {invoice.number}
        </button>
      )}
      fields={fields}
      noun={{ one: 'invoice', other: 'invoices' }}
      search={{
        label: showOrganization
          ? 'Search by number, organization or contract'
          : 'Search by number or contract',
        placeholder: showOrganization ? 'Number, organization or contract' : 'Number or contract',
      }}
      filters={[
        { key: '', label: 'Every status' },
        ...STATUSES.map((status) => ({ key: status, label: INVOICE_STATUS_LABELS[status] })),
      ]}
      query={{ search: text, filter: filters.status ?? '', sort: null, groups: { due: filters.overdue ? OVERDUE : '' } }}
      onQueryChange={(next) => {
        setText(next.search);
        const status = (next.filter || undefined) as InvoiceStatus | undefined;
        const overdue = next.groups?.due === OVERDUE ? true : undefined;
        if (status === filters.status && overdue === filters.overdue) return;
        onFilters({
          pageNumber: 1,
          contractId: filters.contractId,
          ...(status ? { status } : {}),
          ...(overdue ? { overdue } : {}),
        });
      }}
      filterGroups={[
        {
          key: 'due',
          label: 'Due',
          options: [
            { key: '', label: 'Any due date' },
            { key: OVERDUE, label: 'Overdue only' },
          ],
        },
      ]}
      pageInfo={pageInfo}
      onShowDetails={onOpen}
      emptyState={{ title: emptyTitle ?? 'No invoices yet.' }}
      footer={footer}
    />
  );
};
