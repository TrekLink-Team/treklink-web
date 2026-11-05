import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  invoiceKindLabel,
  invoiceTotals,
  INVOICE_STATUS_LABELS,
  lineTypeLabel,
  type InvoiceDetail,
} from '../../entities/billing/api';
import { formatDate, formatDateTime, formatVnd } from '../../shared/lib/format';
import { cn } from '../../shared/ui/cn';

// The business-document parts of the invoice of screen 6.1 (billing api-design 09): the seller and
// buyer blocks, the totals footer, and the print layout that carries them with the lines.

const NOT_RECORDED = 'Not recorded';

const PartyFact: React.FC<{ label: string; value: string | null }> = ({ label, value }) => (
  <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
    <dt className="shrink-0 text-ink-muted sm:w-24">{label}</dt>
    <dd className="min-w-0 break-words text-ink">{value ?? NOT_RECORDED}</dd>
  </div>
);

// Seller (TrekLink, from the backend's COMPANY_* configuration) beside the buyer (the
// organization's registered legal name, tax code and address). Stacked below 640 px.
export const InvoiceParties: React.FC<{ invoice: InvoiceDetail; headingLevel?: 'h3' | 'h4' }> = ({
  invoice,
  headingLevel: Heading = 'h3',
}) => (
  <div className="grid gap-4 sm:grid-cols-2">
    <section aria-label="Seller" className="min-w-0">
      <Heading className="mb-2 text-label uppercase text-ink-muted">Seller</Heading>
      <p className="mb-2 font-semibold text-ink">{invoice.seller.legalName}</p>
      <dl className="flex flex-col gap-1.5 text-sm">
        <PartyFact label="Tax code" value={invoice.seller.taxCode} />
        <PartyFact label="Address" value={invoice.seller.address} />
        <PartyFact label="Hotline" value={invoice.seller.hotline} />
      </dl>
    </section>
    <section aria-label="Buyer" className="min-w-0">
      <Heading className="mb-2 text-label uppercase text-ink-muted">Buyer</Heading>
      <p className="mb-2 font-semibold text-ink">
        {invoice.organization.legalName ?? invoice.organization.code ?? NOT_RECORDED}
      </p>
      <dl className="flex flex-col gap-1.5 text-sm">
        <PartyFact label="Code" value={invoice.organization.code} />
        <PartyFact label="Tax code" value={invoice.organization.taxCode} />
        <PartyFact label="Address" value={invoice.organization.address} />
      </dl>
    </section>
  </div>
);

// Subtotal, credits (only when the invoice has a negative line), total, paid and balance due,
// right-aligned VND (chapter 06 §8.8). The billing spec has no VAT, so neither does the footer.
export const InvoiceTotalsFooter: React.FC<{ invoice: InvoiceDetail; className?: string }> = ({
  invoice,
  className,
}) => {
  const totals = invoiceTotals(invoice);
  const rows: { label: string; amount: number; strong?: boolean }[] = [
    { label: 'Subtotal', amount: totals.subtotalVnd },
    ...(totals.creditsVnd !== 0 ? [{ label: 'Credits and adjustments', amount: totals.creditsVnd }] : []),
    { label: 'Total', amount: totals.totalVnd, strong: true },
    { label: 'Amount paid', amount: totals.paidVnd },
    { label: 'Balance due', amount: totals.balanceVnd, strong: true },
  ];
  return (
    <dl aria-label="Invoice totals" className={cn('ml-auto flex w-full flex-col gap-1.5 text-sm sm:max-w-sm', className)}>
      {rows.map((row) => (
        <div
          key={row.label}
          className={cn(
            'flex items-baseline justify-between gap-4',
            row.strong && 'border-t border-line pt-1.5 font-semibold',
          )}
        >
          <dt className={row.strong ? 'text-ink' : 'text-ink-muted'}>{row.label}</dt>
          <dd className="whitespace-nowrap text-right tabular-nums text-ink">{formatVnd(row.amount)}</dd>
        </div>
      ))}
    </dl>
  );
};

// Printing always uses the light theme, so a page printed from Volt is dark ink on white paper. The
// theme attribute is restored after the print dialog closes. Covers the Print button and the
// browser's own print command.
const usePrintInLightTheme = () => {
  useEffect(() => {
    const root = document.documentElement;
    // The theme to restore, or null while not printing. A second `beforeprint` before `afterprint`
    // (the browser's own around a print it was already asked for) keeps the first saved theme.
    let saved: { theme: string | undefined } | null = null;
    const before = () => {
      if (saved !== null) return;
      saved = { theme: root.dataset.theme };
      root.dataset.theme = 'light';
    };
    const after = () => {
      if (saved === null) return;
      if (saved.theme === undefined) delete root.dataset.theme;
      else root.dataset.theme = saved.theme;
      saved = null;
    };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, []);
};

const CELL = 'border-b border-line px-2 py-1.5 align-top';

// The print layout: a portal on <body>, hidden on screen, that replaces the application in print
// (app/styles/index.css, `data-print-document`). It is the invoice as a document: letterhead,
// parties, the lines as a plain table, the totals footer and the payments.
export const InvoicePrintDocument: React.FC<{ invoice: InvoiceDetail }> = ({ invoice }) => {
  usePrintInLightTheme();
  return createPortal(
    <div data-print-document className="hidden bg-surface p-8 text-sm text-ink print:block">
      <header className="mb-6 flex items-start justify-between gap-6 border-b border-line pb-4">
        <div>
          <p className="text-lg font-bold">{invoice.seller.legalName}</p>
          <p className="text-ink-muted">{invoice.seller.address}</p>
        </div>
        <div className="text-right">
          <p className="text-xl font-bold">Invoice</p>
          <p className="font-semibold">{invoice.number}</p>
        </div>
      </header>
      <dl className="mb-6 grid grid-cols-4 gap-3">
        {[
          ['Issued', formatDateTime(invoice.issuedAt)],
          ['Contract', invoice.contract.code ?? NOT_RECORDED],
          ['Kind', invoiceKindLabel(invoice)],
          ['Status', INVOICE_STATUS_LABELS[invoice.status]],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-label uppercase text-ink-muted">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mb-6">
        <InvoiceParties invoice={invoice} headingLevel="h4" />
      </div>
      <table className="mb-4 w-full border-collapse">
        <caption className="sr-only">Invoice lines</caption>
        <thead>
          <tr className="text-left text-label uppercase text-ink-muted">
            <th scope="col" className={CELL}>No.</th>
            <th scope="col" className={CELL}>Description</th>
            <th scope="col" className={CELL}>Type</th>
            <th scope="col" className={cn(CELL, 'text-right')}>Quantity</th>
            <th scope="col" className={cn(CELL, 'text-right')}>Unit price</th>
            <th scope="col" className={CELL}>Due</th>
            <th scope="col" className={cn(CELL, 'text-right')}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((line) => (
            <tr key={line.seq} className="break-inside-avoid">
              <td className={CELL}>{line.seq}</td>
              <td className={CELL}>{line.description}</td>
              <td className={CELL}>{lineTypeLabel(line.type)}</td>
              <td className={cn(CELL, 'text-right tabular-nums')}>{line.quantity}</td>
              <td className={cn(CELL, 'whitespace-nowrap text-right tabular-nums')}>{formatVnd(line.unitVnd)}</td>
              <td className={cn(CELL, 'whitespace-nowrap')}>{formatDate(line.dueAt)}</td>
              <td className={cn(CELL, 'whitespace-nowrap text-right tabular-nums')}>{formatVnd(line.amountVnd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <InvoiceTotalsFooter invoice={invoice} className="mb-6 break-inside-avoid" />
      {invoice.payments.length > 0 && (
        <section aria-label="Payments" className="mb-6 break-inside-avoid">
          <h4 className="mb-2 text-label uppercase text-ink-muted">Payments</h4>
          <ul className="flex flex-col gap-1">
            {invoice.payments.map((payment) => (
              <li key={payment.id} className="flex justify-between gap-4">
                <span>
                  {payment.reference}
                  {payment.isSandbox ? ', SANDBOX' : ''}
                </span>
                <span className="tabular-nums">
                  {formatVnd(payment.amountVnd)}, {payment.status.toLowerCase()}
                  {payment.confirmedAt ? `, ${formatDateTime(payment.confirmedAt)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <footer className="border-t border-line pt-3 text-xs text-ink-muted">
        Issued lines are not edited; a correction is added as an adjustment line. Questions:{' '}
        {invoice.seller.hotline}.
      </footer>
    </div>,
    document.body,
  );
};
