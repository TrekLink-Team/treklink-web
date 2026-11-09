import React, { useEffect, useRef, useState } from 'react';
import { Printer, Receipt } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError } from '../../shared/api/apiClient';
import {
  INVOICE_STATUS_LABELS,
  INVOICE_TONES,
  invoiceKindLabel,
  requestSepayPayment,
  lineStatus,
  lineTypeLabel,
  useBalance,
  useInvoice,
  type InvoiceLine,
} from '../../entities/billing/api';
import { formatDate, formatDateTime, formatVnd } from '../../shared/lib/format';
import { Alert, Button, CollectionView, type CollectionField } from '../../shared/ui';
import { Badge, ErrorState, Fact, Loading } from '../../shared/ui/bits';
import { PageScrollBody, PinnedTitle } from '../../shared/ui/PageChrome';
import { cn } from '../../shared/ui/cn';
import { TONE_CLASSES } from '../../shared/ui/status';
import { CARD, LINK } from '../../shared/ui/styles';
import { MarkRefundedDialog } from '../../features/mark-refunded/MarkRefundedDialog';
import { CounterPaymentDialog } from './CounterPaymentDialog';
import { InvoiceParties, InvoicePrintDocument, InvoiceTotalsFooter } from './InvoiceDocument';

// Line status tones (TrekLink System Colors, shared/ui/status.ts).
const LINE_TONES: Record<string, string> = {
  Paid: TONE_CLASSES.done,
  Overdue: TONE_CLASSES.critical,
  'Due now': TONE_CLASSES.attention,
  'Due later': TONE_CLASSES.active,
  Credit: TONE_CLASSES.done,
};

const METHOD_LABELS = { CASH: 'Cash', BANK_TRANSFER: 'Bank transfer', SEPAY: 'SePay' } as const;

// Every field is compact and none leaves a narrow list: a phone row and the Staff panel beside the
// invoice list (under 1100 px) keep the type, quantity and due date a person reads before paying
// (review of treklink-web#355). Each value names itself without its column header.
const LINE_FIELDS: CollectionField<InvoiceLine>[] = [
  {
    key: 'type',
    label: 'Type',
    render: (line) => lineTypeLabel(line.type),
    text: (line) => lineTypeLabel(line.type),
    compact: true,
  },
  {
    key: 'quantity',
    label: 'Quantity',
    render: (line) => (
      <span className="whitespace-nowrap text-ink-muted">
        {line.quantity} x {formatVnd(line.unitVnd)}
      </span>
    ),
    compact: true,
  },
  {
    key: 'due',
    label: 'Due',
    render: (line) => <span className="whitespace-nowrap">Due {formatDate(line.dueAt)}</span>,
    text: (line) => line.dueAt,
    sortable: true,
    compact: true,
  },
  {
    key: 'amount',
    label: 'Amount',
    align: 'end',
    render: (line) => <span className="font-semibold">{formatVnd(line.amountVnd)}</span>,
    sortValue: (line) => line.amountVnd,
    compact: true,
  },
  {
    key: 'status',
    label: 'Status',
    render: (line) => (
      <Badge tone={LINE_TONES[lineStatus(line)] ?? LINE_TONES['Due later']}>
        {lineStatus(line)}
      </Badge>
    ),
    text: lineStatus,
    compact: true,
  },
];

// The invoice detail of screen 6.1 (billing api-design 09): header, dated lines with a status derived
// on the client, and payments. TrekLink Staff and Admin record a counter payment from here (6.3);
// the Org Manager pays with SePay (6.2, billing api-design 11) and is taken to the QR page. On its own
// page the invoice number is the page's h1 (`asPageTitle`); beside the Staff list it is an h2. The
// lines render through CollectionView (chapter 06 §9, D-096), searched and filtered in the browser.
// As a business document it carries the seller and buyer blocks and a totals footer, and prints as
// the document alone (InvoiceDocument.tsx).
/**
 * The invoice body: on the invoice page it is the one scroll region under the pinned number (ui
 * standard §7); in the billing side panel it is plain content.
 */
const InvoiceBody: React.FC<{ page?: boolean; children: React.ReactNode }> = ({ page, children }) =>
  page ? (
    <PageScrollBody label="Invoice details" className="flex flex-col gap-4">
      {children}
    </PageScrollBody>
  ) : (
    <>{children}</>
  );

export const InvoiceDetailView: React.FC<{
  invoiceId: string;
  contractPath: (contractId: string) => string;
  canRecordCounter: boolean;
  canPayOnline?: boolean;
  asPageTitle?: boolean;
  /** Moves focus to the invoice number once it loads (screen 6.1: opening an invoice from a list). */
  focusOnOpen?: boolean;
}> = ({
  invoiceId,
  contractPath,
  canRecordCounter,
  canPayOnline = false,
  asPageTitle = false,
  focusOnOpen = false,
}) => {
  const { data, isLoading, error, refetch } = useInvoice(invoiceId);
  // On a phone the invoice opens below the list: focus moves to its number and its first card scrolls
  // into view, so the facts and the payment action are on screen (W21).
  const heading = useRef<HTMLHeadingElement>(null);
  const summary = useRef<HTMLDivElement>(null);
  const loaded = Boolean(data);
  useEffect(() => {
    if (!focusOnOpen || !loaded) return;
    heading.current?.focus({ preventScroll: true });
    // The whole first card, with its facts and payment action, comes into view; a card already on
    // screen (the side panel on a wide screen) does not move.
    summary.current?.scrollIntoView?.({ block: 'nearest' });
  }, [focusOnOpen, loaded]);
  const navigate = useNavigate();
  const [recording, setRecording] = useState(false);
  const [refunding, setRefunding] = useState(false);
  // A cancelled contract's voiding ADJUSTMENT sits on its CLOSING invoice, so an earlier invoice
  // can still show an amount due while the contract owes nothing. Payment actions show only while
  // the contract balance is open (ruling on #87 point 4); invoice lines stay unchanged.
  const owing = (canRecordCounter || canPayOnline) && !!data && data.totalVnd > data.paidVnd;
  const balance = useBalance(data?.contract.id ?? '', owing);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  const pay = async () => {
    if (!data) return;
    setPaying(true);
    setPayError(null);
    try {
      const payment = await requestSepayPayment(data.id);
      navigate(`/o/pay/${payment.id}`);
    } catch (failure) {
      setPaying(false);
      const waiting = data.payments.find(
        (payment) => payment.method === 'SEPAY' && payment.status === 'PENDING',
      );
      // PAYMENT_PENDING: open the request that is already waiting (screen 6.1 States).
      if (failure instanceof ApiError && failure.errorCode === 'PAYMENT_PENDING' && waiting) {
        navigate(`/o/pay/${waiting.id}`);
        return;
      }
      setPayError(failure instanceof ApiError ? failure.message : 'Something went wrong.');
      if (failure instanceof ApiError && failure.errorCode === 'NOTHING_DUE') void refetch();
    }
  };

  if (isLoading) return <Loading label="Loading invoice" />;
  if (error || !data) return <ErrorState error={error} onRetry={() => void refetch()} />;
  const due = data.totalVnd - data.paidVnd;

  // D-097 amended (billing REQ-STA-04): a credit due names whom and how much after the two-word badge.
  const creditDue = data.status === 'CREDIT_DUE' ? (data.creditDueVnd ?? 0) : null;
  const badge = (
    <Badge
      tone={INVOICE_TONES[data.status]}
      after={
        creditDue !== null
          ? `to organization, ${formatVnd(creditDue)}`
          : data.status === 'REFUNDED' && data.refund
            ? `${formatVnd(data.refund.amountVnd)}, ${formatDateTime(data.refund.at)}`
            : undefined
      }
    >
      {data.status === 'CREDIT_DUE' ? 'Credit due' : INVOICE_STATUS_LABELS[data.status]}
    </Badge>
  );
  return (
    <div
      data-fit-page={asPageTitle ? '' : undefined}
      className={cn('flex flex-col gap-4', asPageTitle && 'min-h-0 flex-1')}
    >
      {/* On its own page the number is the page title, pinned above the summary (ui standard §7). */}
      {asPageTitle && (
        <PinnedTitle>
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <h1 ref={heading} tabIndex={-1} className="text-title-lg text-ink outline-none">
              {data.number}
            </h1>
            {badge}
          </div>
        </PinnedTitle>
      )}
      <InvoiceBody page={asPageTitle}>
        <div ref={summary} className={CARD}>
          {!asPageTitle && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 ref={heading} tabIndex={-1} className="text-xl font-bold text-ink">
                {data.number}
              </h2>
              {badge}
            </div>
          )}
          {/* Two columns on a phone, so the facts and the main action share the first screen (W21). */}
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Fact label="Contract">
              <Link to={contractPath(data.contract.id)} className={LINK}>
                {data.contract.code ?? 'Open contract'}
              </Link>
            </Fact>
            <Fact label="Kind">{invoiceKindLabel(data)}</Fact>
            <Fact label="Issued">{formatDateTime(data.issuedAt)}</Fact>
            <Fact label="Total">{formatVnd(data.totalVnd)}</Fact>
            <Fact label="Paid">{formatVnd(data.paidVnd)}</Fact>
            {creditDue !== null ? (
              <Fact label="Credit due to organization">{formatVnd(creditDue)}</Fact>
            ) : data.status === 'REFUNDED' && data.refund ? (
              <Fact label="Refunded to organization">
                {formatVnd(data.refund.amountVnd)}, {formatDateTime(data.refund.at)}: {data.refund.note}
              </Fact>
            ) : (
              <Fact label="Still due">{formatVnd(Math.max(due, 0))}</Fact>
            )}
          </dl>
          {creditDue === 0 && (
            <p className="mt-3 text-body-sm text-ink-muted">
              The credit is set against the contract's unpaid invoices, so nothing is owed back yet.
            </p>
          )}
          {payError && (
            <Alert tone="error" className="mt-3">
              {payError}
            </Alert>
          )}
          <div className="mt-4 flex flex-wrap gap-3">
            {canPayOnline && owing && balance.data && !balance.data.settled && (
              <Button
                variant="primary"
                className="min-h-11 w-full sm:w-auto"
                loading={paying}
                loadingLabel="Preparing QR"
                onClick={() => void pay()}
              >
                Pay with SePay
              </Button>
            )}
            {/* Staff and Admin, who also record counter payments (billing design section 11.5). */}
            {canRecordCounter && creditDue !== null && creditDue > 0 && (
              <Button variant="primary" onClick={() => setRefunding(true)}>
                Mark refunded
              </Button>
            )}
            {canRecordCounter && owing && balance.data && !balance.data.settled && (
              <Button variant="primary" onClick={() => setRecording(true)}>
                Record counter payment
              </Button>
            )}
            <Button
              variant="secondary"
              icon={<Printer aria-hidden className="h-4 w-4" />}
              onClick={() => window.print()}
            >
              Print invoice
            </Button>
          </div>
          {/* The parties follow the actions: on a phone the facts and Pay come first (W21). */}
          <div className="mt-4 border-t border-line pt-4">
            <InvoiceParties invoice={data} />
          </div>
        </div>

        <div className={CARD}>
          <h3 className="mb-3 font-bold text-ink">Lines</h3>
          <CollectionView<InvoiceLine>
            icon={<Receipt />}
            label={`Lines of ${data.number}`}
            items={data.lines}
            itemId={(line) => String(line.seq)}
            itemName={(line) => `Line ${line.seq}, ${line.description}`}
            itemTitle={(line) => (
              <span className="flex flex-col">
                <span className="font-semibold text-ink">{line.description}</span>
                <span className="text-caption text-ink-muted">Line {line.seq}</span>
              </span>
            )}
            fields={LINE_FIELDS}
            // Beside the TrekLink list the panel is 440 px wide, too narrow for the five-column table,
            // so the lines open as cards there, as on a phone (screen 6.1); the view menu still offers
            // the table. The invoice page keeps the Details list (TK-212).
            defaultView={asPageTitle ? undefined : 'mediumCards'}
            noun={{ one: 'line', other: 'lines' }}
            search={{ label: 'Search lines', placeholder: 'Description or type' }}
            filters={[
              { key: '', label: 'Every status' },
              ...Object.keys(LINE_TONES).map((value) => ({
                key: value,
                label: value,
                test: (line: InvoiceLine) => lineStatus(line) === value,
              })),
            ]}
            details={false}
            emptyState={{ title: 'This invoice has no lines.' }}
            noMatch={{ title: 'No lines match these filters.' }}
          />
          <InvoiceTotalsFooter invoice={data} className="mt-4 border-t border-line pt-4" />
          <p className="mt-3 text-xs text-ink-muted">
            Issued lines are not edited; a correction is added as an adjustment line.
          </p>
        </div>

        <div className={CARD}>
          <h3 className="mb-3 font-bold text-ink">Payments</h3>
          {data.payments.length === 0 ? (
            <p className="text-sm text-ink-muted">No payments recorded.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {data.payments.map((payment) => (
                <li key={payment.id} className="flex flex-wrap justify-between gap-2">
                  <span>
                    {payment.reference}, {METHOD_LABELS[payment.method]}
                    {payment.isSandbox && (
                      <Badge tone="attention" className="ml-2">
                        SANDBOX
                      </Badge>
                    )}
                  </span>
                  <span className="text-right">
                    {formatVnd(payment.amountVnd)}, {payment.status.toLowerCase()}
                    {payment.confirmedAt ? `, ${formatDateTime(payment.confirmedAt)}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </InvoiceBody>

      {recording && <CounterPaymentDialog invoice={data} onClose={() => setRecording(false)} />}
      {refunding && <MarkRefundedDialog invoice={data} onClose={() => setRefunding(false)} />}
      <InvoicePrintDocument invoice={data} />
    </div>
  );
};
