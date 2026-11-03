import React from 'react';
import { useInvoice, useInvoices } from '../../entities/billing/api';
import type { ContractDetail } from '../../entities/contract/api';
import { formatDateTime, formatVnd, viewerTimeZone } from '../../shared/lib/format';
import { Alert } from '../../shared/ui/Alert';
import { Badge } from '../../shared/ui/Badge';
import { Card, CardHeader } from '../../shared/ui/Card';
import { ErrorState, Loading } from '../../shared/ui/bits';

/**
 * The deposit of a request (rentals design §2.1, D-092 rule 1): term 1 and its invoice are created
 * with the request, and the invoice's first line, the holding fee or the day-plan fee, is the
 * deposit. An unpaid hold ends at `holdExpiresAt` and the request is cancelled. Read from billing
 * api-design 08 and 09; nothing here is computed in the browser.
 */
export const DepositCard: React.FC<{
  contract: ContractDetail;
  scope: 'o' | 't';
  viewer: 'staff' | 'manager';
}> = ({ contract, scope, viewer }) => {
  const invoices = useInvoices(scope, { contractId: contract.id });
  const firstId =
    invoices.data?.items
      .slice()
      .sort((a, b) => a.issuedAt.localeCompare(b.issuedAt))
      .at(0)?.id ?? null;
  const invoice = useInvoice(firstId);
  const deposit = invoice.data?.lines.slice().sort((a, b) => a.seq - b.seq)[0];
  const paid = deposit ? deposit.paidVnd >= deposit.amountVnd : false;
  const hold = contract.holdExpiresAt;

  return (
    <div className="flex flex-col gap-3">
      {deposit && !paid && hold && (
        <Alert
          tone="info"
          title={
            viewer === 'manager'
              ? 'Pay the deposit to keep your request'
              : 'The deposit is not paid yet'
          }
        >
          {viewer === 'manager'
            ? `Your request holds its units until ${formatDateTime(hold)}. Pay the deposit of ${formatVnd(deposit.amountVnd - deposit.paidVnd)} before then. TrekLink Staff then review the request.`
            : `The request holds its units until ${formatDateTime(hold)}. An unpaid hold then ends and the request is cancelled.`}
        </Alert>
      )}
      <Card padding="sm">
        <CardHeader title="Deposit" description="The first line of the term 1 invoice" />
        {(invoices.isLoading || invoice.isLoading) && <Loading />}
        {invoices.error ? (
          <ErrorState error={invoices.error} onRetry={() => void invoices.refetch()} />
        ) : null}
        {invoice.error ? (
          <ErrorState error={invoice.error} onRetry={() => void invoice.refetch()} />
        ) : null}
        {invoices.data && invoices.data.items.length === 0 && (
          <p className="text-body-sm text-ink-muted">No invoice is issued for this request yet.</p>
        )}
        {deposit && invoice.data && (
          <dl className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-3 gap-y-2">
            <dt className="text-body-sm text-ink-muted">Amount</dt>
            <dd className="text-title-sm tabular-nums text-ink">{formatVnd(deposit.amountVnd)}</dd>
            <dt className="text-body-sm text-ink-muted">Line</dt>
            <dd className="text-body text-ink">{deposit.description}</dd>
            <dt className="text-body-sm text-ink-muted">Status</dt>
            <dd>
              <Badge
                tone={paid ? 'done' : deposit.paidVnd > 0 ? 'waiting' : 'attention'}
                after={!paid && deposit.paidVnd > 0 ? `${formatVnd(deposit.paidVnd)} paid` : undefined}
              >
                {paid ? 'Paid' : deposit.paidVnd > 0 ? 'Partly paid' : 'Not paid'}
              </Badge>
            </dd>
            {hold && !paid && (
              <>
                <dt className="text-body-sm text-ink-muted">Pay by</dt>
                <dd className="text-body tabular-nums text-ink">
                  <time dateTime={hold} title={viewerTimeZone()}>
                    {formatDateTime(hold)}
                  </time>
                </dd>
              </>
            )}
            <dt className="text-body-sm text-ink-muted">Invoice</dt>
            <dd className="text-body tabular-nums text-ink">{invoice.data.number}</dd>
          </dl>
        )}
      </Card>
    </div>
  );
};
