import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  INVOICE_STATUS_LABELS,
  INVOICE_TONES,
  lineStatus,
  useInvoice,
} from '../../entities/billing/api';
import { formatDate, formatDateTime, formatVnd } from '../../shared/lib/format';
import { Badge, ErrorState, Fact, Loading } from '../../shared/ui/bits';
import { CARD, LINK, PRIMARY_BUTTON, TD, TH } from '../../shared/ui/styles';
import { matchesText } from '../../shared/lib/filter';
import { FilterRow, NoMatchRow } from '../../shared/ui/TableFilters';
import { CounterPaymentDialog } from './CounterPaymentDialog';

const LINE_TONES: Record<string, string> = {
  Paid: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  Overdue: 'bg-red-50 text-red-800 border-red-200',
  'Due now': 'bg-amber-50 text-amber-900 border-amber-200',
  'Due later': 'bg-slate-100 text-slate-700 border-slate-300',
};

const METHOD_LABELS = { CASH: 'Cash', BANK_TRANSFER: 'Bank transfer', SEPAY: 'SePay' } as const;

// The invoice detail of screen 6.1 (billing api-design 09): header, dated lines with a status derived
// on the client, and payments. TrekLink Staff and Admin record a counter payment from here (6.3);
// Pay with SePay (6.2) joins with its task.
export const InvoiceDetailView: React.FC<{
  invoiceId: string;
  contractPath: (contractId: string) => string;
  canRecordCounter: boolean;
}> = ({ invoiceId, contractPath, canRecordCounter }) => {
  const { data, isLoading, error, refetch } = useInvoice(invoiceId);
  const [recording, setRecording] = useState(false);
  const [lineText, setLineText] = useState('');
  const [lineFilter, setLineFilter] = useState('');

  if (isLoading) return <Loading label="Loading invoice" />;
  if (error || !data) return <ErrorState error={error} onRetry={() => void refetch()} />;
  const due = data.totalVnd - data.paidVnd;
  const lines = data.lines.filter(
    (line) =>
      matchesText(lineText, line.description, line.type) &&
      (lineFilter === '' || lineStatus(line) === lineFilter),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className={CARD}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-bold text-slate-900">{data.number}</h2>
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
        {canRecordCounter && due > 0 && (
          <button
            type="button"
            className={`${PRIMARY_BUTTON} mt-4`}
            onClick={() => setRecording(true)}
          >
            Record counter payment
          </button>
        )}
      </div>

      <div className={CARD}>
        <h3 className="mb-3 font-bold text-slate-900">Lines</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className={TH}>#</th>
                <th className={TH}>Line</th>
                <th className={TH}>Due</th>
                <th className={`${TH} text-right`}>Amount</th>
                <th className={TH}>Status</th>
              </tr>
              <FilterRow
                columns={[
                  null,
                  { label: 'line', kind: 'text', value: lineText, onChange: setLineText },
                  null,
                  null,
                  {
                    label: 'line status',
                    kind: 'select',
                    value: lineFilter,
                    onChange: setLineFilter,
                    options: Object.keys(LINE_TONES).map((value) => ({ value, label: value })),
                  },
                ]}
                onClear={() => {
                  setLineText('');
                  setLineFilter('');
                }}
              />
            </thead>
            <tbody>
              {lines.length === 0 && (
                <NoMatchRow
                  colSpan={5}
                  onClear={() => {
                    setLineText('');
                    setLineFilter('');
                  }}
                />
              )}
              {lines.map((line) => {
                const status = lineStatus(line);
                return (
                  <tr key={line.seq} className="border-b border-slate-100 last:border-0">
                    <td className={`${TD} text-slate-600`}>{line.seq}</td>
                    <td className={TD}>
                      <span className="font-semibold text-slate-900">{line.description}</span>
                      <span className="block text-xs text-slate-600">
                        {line.quantity} x {formatVnd(line.unitVnd)}
                      </span>
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>{formatDate(line.dueAt)}</td>
                    <td className={`${TD} whitespace-nowrap text-right font-semibold`}>
                      {formatVnd(line.amountVnd)}
                    </td>
                    <td className={TD}>
                      <Badge tone={LINE_TONES[status] ?? LINE_TONES['Due later']}>{status}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-slate-600">
          Lines never change; corrections are ADJUSTMENT lines.
        </p>
      </div>

      <div className={CARD}>
        <h3 className="mb-3 font-bold text-slate-900">Payments</h3>
        {data.payments.length === 0 ? (
          <p className="text-sm text-slate-700">No payments recorded.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {data.payments.map((payment) => (
              <li key={payment.id} className="flex flex-wrap justify-between gap-2">
                <span>
                  {payment.reference}, {METHOD_LABELS[payment.method]}
                  {payment.isSandbox && (
                    <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-bold text-amber-900">
                      SANDBOX
                    </span>
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
