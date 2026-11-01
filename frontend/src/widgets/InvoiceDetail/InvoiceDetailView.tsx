import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError } from '../../shared/api/apiClient';
import {
  INVOICE_STATUS_LABELS,
  INVOICE_TONES,
  requestSepayPayment,
  lineStatus,
  useBalance,
  useInvoice,
  type InvoiceLine,
} from '../../entities/billing/api';
import { formatDate, formatDateTime, formatVnd } from '../../shared/lib/format';
import { Alert, Button, DataTable, Select, Toolbar, ToolbarSearch, type Column } from '../../shared/ui';
import { Badge, ErrorState, Fact, Loading } from '../../shared/ui/bits';
import { TONE_CLASSES } from '../../shared/ui/status';
import { CARD, LINK } from '../../shared/ui/styles';
import { matchesText } from '../../shared/lib/filter';
import { CounterPaymentDialog } from './CounterPaymentDialog';

// Line status tones (TrekLink System Colors, shared/ui/status.ts).
const LINE_TONES: Record<string, string> = {
  Paid: TONE_CLASSES.done,
  Overdue: TONE_CLASSES.critical,
  'Due now': TONE_CLASSES.attention,
  'Due later': TONE_CLASSES.active,
};

const METHOD_LABELS = { CASH: 'Cash', BANK_TRANSFER: 'Bank transfer', SEPAY: 'SePay' } as const;

// The invoice detail of screen 6.1 (billing api-design 09): header, dated lines with a status derived
// on the client, and payments. TrekLink Staff and Admin record a counter payment from here (6.3);
// the Org Manager pays with SePay (6.2, billing api-design 11) and is taken to the QR page. On its own
// page the invoice number is the page's h1 (`asPageTitle`); beside the Staff list it is an h2.
export const InvoiceDetailView: React.FC<{
  invoiceId: string;
  contractPath: (contractId: string) => string;
  canRecordCounter: boolean;
  canPayOnline?: boolean;
  asPageTitle?: boolean;
}> = ({ invoiceId, contractPath, canRecordCounter, canPayOnline = false, asPageTitle = false }) => {
  const { data, isLoading, error, refetch } = useInvoice(invoiceId);
  const navigate = useNavigate();
  const [recording, setRecording] = useState(false);
  const [lineText, setLineText] = useState('');
  const [lineFilter, setLineFilter] = useState('');
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
  const lines = data.lines.filter(
    (line) =>
      matchesText(lineText, line.description, line.type) &&
      (lineFilter === '' || lineStatus(line) === lineFilter),
  );

  const lineColumns: Column<InvoiceLine>[] = [
    { key: 'seq', header: '#', cell: (line) => <span className="text-ink-muted">{line.seq}</span>, width: '3rem' },
    {
      key: 'line',
      header: 'Line',
      cell: (line) => (
        <span className="flex flex-col py-1">
          <span className="font-semibold text-ink">{line.description}</span>
          <span className="text-xs text-ink-muted">
            {line.quantity} x {formatVnd(line.unitVnd)}
          </span>
        </span>
      ),
    },
    { key: 'due', header: 'Due', cell: (line) => <span className="whitespace-nowrap">{formatDate(line.dueAt)}</span> },
    { key: 'amount', header: 'Amount', align: 'end', cell: (line) => <span className="font-semibold">{formatVnd(line.amountVnd)}</span> },
    {
      key: 'status',
      header: 'Status',
      cell: (line) => <Badge tone={LINE_TONES[lineStatus(line)] ?? LINE_TONES['Due later']}>{lineStatus(line)}</Badge>,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className={CARD}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {asPageTitle ? (
            <h1 className="text-title-lg text-ink">{data.number}</h1>
          ) : (
            <h2 className="text-xl font-bold text-ink">{data.number}</h2>
          )}
          <Badge tone={INVOICE_TONES[data.status]}>{INVOICE_STATUS_LABELS[data.status]}</Badge>
        </div>
        <dl className="grid gap-3 sm:grid-cols-3">
          <Fact label="Contract">
            <Link to={contractPath(data.contract.id)} className={LINK}>
              {data.contract.code ?? 'Open contract'}
            </Link>
          </Fact>
          <Fact label="Kind">
            {data.kind === 'TERM' && data.term
              ? `Term ${data.term.seq}`
              : data.kind.replace('_', ' ')}
          </Fact>
          <Fact label="Issued">{formatDateTime(data.issuedAt)}</Fact>
          <Fact label="Total">{formatVnd(data.totalVnd)}</Fact>
          <Fact label="Paid">{formatVnd(data.paidVnd)}</Fact>
          <Fact label="Still due">{formatVnd(Math.max(due, 0))}</Fact>
        </dl>
        {payError && (
          <Alert tone="error" className="mt-3">
            {payError}
          </Alert>
        )}
        {canPayOnline && owing && balance.data && !balance.data.settled && (
          <Button
            variant="primary"
            className="mt-4 w-full sm:w-auto"
            loading={paying}
            loadingLabel="Preparing QR"
            onClick={() => void pay()}
          >
            Pay with SePay
          </Button>
        )}
        {canRecordCounter && owing && balance.data && !balance.data.settled && (
          <Button variant="primary" className="mt-4" onClick={() => setRecording(true)}>
            Record counter payment
          </Button>
        )}
      </div>

      <div className={CARD}>
        <h3 className="mb-3 font-bold text-ink">Lines</h3>
        <Toolbar
          label="Invoice line filters"
          start={
            <>
              <ToolbarSearch id={`invoice-line-search-${data.id}`} label="Search lines" value={lineText} onChange={setLineText} />
              <span className="w-40">
                <Select aria-label="Line status" value={lineFilter} onChange={(event) => setLineFilter(event.target.value)}>
                  <option value="">Every status</option>
                  {Object.keys(LINE_TONES).map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </Select>
              </span>
            </>
          }
        />
        <DataTable<InvoiceLine>
          caption={`Lines of ${data.number}`}
          columns={lineColumns}
          rows={lines}
          rowId={(line) => String(line.seq)}
          empty={{
            title: 'No lines match these filters.',
            action: (
              <Button
                onClick={() => {
                  setLineText('');
                  setLineFilter('');
                }}
              >
                Clear filters
              </Button>
            ),
          }}
        />
        <p className="mt-3 text-xs text-ink-muted">
          Lines never change; corrections are ADJUSTMENT lines.
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

      {recording && <CounterPaymentDialog invoice={data} onClose={() => setRecording(false)} />}
    </div>
  );
};
