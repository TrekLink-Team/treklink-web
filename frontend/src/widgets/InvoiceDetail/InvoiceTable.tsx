import React from 'react';
import { INVOICE_STATUS_LABELS, INVOICE_TONES, type Invoice } from '../../entities/billing/api';
import { formatDate, formatVnd } from '../../shared/lib/format';
import { Badge } from '../../shared/ui/bits';

// The invoice list of screen 6.1 as rows on a wide screen and cards on a narrow one. The TrekLink
// view adds the organization column.
export const InvoiceTable: React.FC<{
  invoices: Invoice[];
  showOrganization: boolean;
  selectedId?: string | null;
  onOpen: (invoice: Invoice) => void;
}> = ({ invoices, showOrganization, selectedId, onOpen }) => (
  <>
    <ul className="flex flex-col gap-2 md:hidden">
      {invoices.map((invoice) => (
        <li key={invoice.id}>
          <button
            type="button"
            onClick={() => onOpen(invoice)}
            className="w-full rounded-xl border border-slate-200 bg-white p-4 text-left"
          >
            <span className="flex justify-between">
              <span className="font-semibold">{invoice.number}</span>
              <Badge tone={INVOICE_TONES[invoice.status]}>
                {INVOICE_STATUS_LABELS[invoice.status]}
              </Badge>
            </span>
            <span className="block text-sm text-slate-700">
              {invoice.contract.code}, {formatVnd(invoice.totalVnd)}, paid{' '}
              {formatVnd(invoice.paidVnd)}
            </span>
          </button>
        </li>
      ))}
    </ul>
    <table className="hidden w-full overflow-hidden rounded-xl border border-slate-200 bg-white text-sm shadow-sm md:table">
      <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
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
      </thead>
      <tbody>
        {invoices.map((invoice) => (
          <tr
            key={invoice.id}
            className={`border-t border-slate-200 ${invoice.id === selectedId ? 'bg-blue-50' : ''}`}
          >
            <td className="px-3 py-3">
              <button
                type="button"
                className="font-semibold text-blue-700 hover:underline"
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
