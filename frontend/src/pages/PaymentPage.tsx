import React, { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { usePayment } from '../entities/billing/api';
import { formatDateTime, formatVnd } from '../shared/lib/format';
import { Alert, Badge, Card, PageHeader, Skeleton } from '../shared/ui';
import { ErrorState } from '../shared/ui/bits';
import { LINK } from '../shared/ui/styles';

// mm:ss left until `expiresAt`, never below zero.
const remaining = (expiresAt: string | null, now: number): string => {
  if (!expiresAt) return '';
  const seconds = Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};

// /o/pay/:paymentId, screen 6.2 (billing api-design 11 and 15): the VietQR of a sandbox payment,
// labelled SANDBOX, polled until CONFIRMED (MSG20) or EXPIRED (MSG25). Reached from the invoice, so
// it has no navigation entry.
export const PaymentPage: React.FC = () => {
  const { paymentId = '' } = useParams();
  const queryClient = useQueryClient();
  const [now, setNow] = useState(() => Date.now());
  // The QR service answers no image for an account or bank code it cannot read, such as the
  // sandbox placeholders; the transfer details below still let the payment go through.
  const [qrFailed, setQrFailed] = useState(false);
  const payment = usePayment(paymentId);
  const status = payment.data?.status;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Once the payment settles (polling stops by itself), refresh what the payment changed.
  useEffect(() => {
    if (!status || status === 'PENDING') return;
    void queryClient.invalidateQueries({ queryKey: ['invoices'] });
    if (payment.data) {
      void queryClient.invalidateQueries({ queryKey: ['invoice', payment.data.invoiceId] });
      void queryClient.invalidateQueries({
        queryKey: ['contract-balance', payment.data.contractId],
      });
    }
  }, [status, payment.data, queryClient]);

  if (payment.isLoading) {
    return (
      <section className="mx-auto flex max-w-lg flex-col gap-4" role="status" aria-live="polite">
        <span className="sr-only">Loading payment</span>
        <Skeleton className="h-8 w-48" />
        <Card className="flex flex-col items-center gap-4">
          <Skeleton className="h-64 w-64" rounded="panel" />
          <Skeleton className="h-12 w-full" />
        </Card>
      </section>
    );
  }
  if (payment.error || !payment.data) {
    return <ErrorState error={payment.error} onRetry={() => void payment.refetch()} />;
  }
  const data = payment.data;
  // A transfer of another amount is credited separately; the page must not then say nothing was
  // charged (review of #92).
  const credited = (data.receivedLater ?? []).reduce(
    (sum, received) => sum + received.amountVnd,
    0,
  );
  const back = `/o/invoices/${data.invoiceId}`;
  const backLink = (
    <Link to={back} className={LINK}>
      Back to the invoice
    </Link>
  );

  return (
    <section aria-labelledby="pay-title" className="mx-auto flex max-w-lg flex-col gap-4">
      <PageHeader
        id="pay-title"
        title="Pay with SePay"
        meta={data.isSandbox ? <Badge tone="attention">SANDBOX</Badge> : undefined}
        actions={backLink}
        className="mb-0"
      />

      {data.status === 'PENDING' && data.vietQr && (
        <>
          <Alert tone="info" title={`Expires in ${remaining(data.expiresAt, now)}`}>
            Scan with your banking app and keep the transfer content exactly as shown. This page
            updates by itself once the payment arrives.
          </Alert>
          <Card className="flex flex-col items-center gap-4">
            {qrFailed ? (
              <Alert tone="warning" title="The QR image could not be loaded." className="w-full">
                Transfer the amount to the account below with the transfer content exactly as shown.
              </Alert>
            ) : (
              // Literal white keeps banking-app scanner contrast; a theme surface would turn dark in Volt.
              <img
                src={data.vietQr.imageUrl}
                alt={`VietQR for ${formatVnd(data.amountVnd)} with transfer content ${data.vietQr.content}`}
                onError={() => setQrFailed(true)}
                className="h-64 w-64 rounded-card border border-line bg-[#fff] object-contain"
              />
            )}
            <dl className="grid w-full grid-cols-2 gap-3 text-body">
              <div>
                <dt className="text-body-sm font-semibold text-ink-muted">Amount</dt>
                <dd className="text-title-sm text-ink">{formatVnd(data.amountVnd)}</dd>
              </div>
              <div>
                <dt className="text-body-sm font-semibold text-ink-muted">Transfer content</dt>
                <dd className="font-mono text-title-sm text-ink">{data.vietQr.content}</dd>
              </div>
              <div>
                <dt className="text-body-sm font-semibold text-ink-muted">Account</dt>
                <dd className="text-ink">{data.vietQr.bankAccount}</dd>
              </div>
            </dl>
          </Card>
        </>
      )}
      {data.status === 'CONFIRMED' && (
        <Alert tone="success" title={`Payment of ${formatVnd(data.amountVnd)} received.`}>
          {data.confirmedAt && `Confirmed ${formatDateTime(data.confirmedAt)}.`}
        </Alert>
      )}
      {credited > 0 && (
        <Alert
          tone="info"
          title={`${formatVnd(credited)} arrived for this request and was recorded.`}
          action={
            <Link to={back} className={LINK}>
              See what remains due
            </Link>
          }
        >
          This transfer was recorded as a separate payment for this request.
        </Alert>
      )}
      {(data.status === 'EXPIRED' || data.status === 'FAILED') && credited === 0 && (
        <Alert
          tone="error"
          title="Payment not completed."
          action={
            <Link to={back} className={LINK}>
              Back to the invoice to try again
            </Link>
          }
        >
          Nothing was charged. {formatVnd(data.amountVnd)} remains due.
        </Alert>
      )}
    </section>
  );
};
