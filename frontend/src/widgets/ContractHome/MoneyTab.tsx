import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CreditCard } from 'lucide-react';
import { useBalance, useInvoices, type Invoice } from '../../entities/billing/api';
import type { ContractDetail } from '../../entities/contract/api';
import { ServiceCreditsCard } from '../../features/service-credits/ServiceCreditsCard';
import { formatDateTime, formatVnd } from '../../shared/lib/format';
import { useMediaQuery } from '../../shared/lib/useMediaQuery';
import { Card, CardHeader } from '../../shared/ui/Card';
import { CollectionView, type CollectionField } from '../../shared/ui/collection-view';
import { ErrorState, Loading } from '../../shared/ui/bits';
import { StatCard } from '../../shared/ui/StatCard';
import { LINK } from '../../shared/ui/styles';

const INVOICE_STATUS: Record<Invoice['status'], string> = {
  ISSUED: 'Issued',
  PARTIALLY_PAID: 'Partly paid',
  PAID: 'Paid',
};

/**
 * The Money tab, for TrekLink Staff and the Org Manager (screen 5.2): the balance (billing api-design
 * 10), the contract's invoices on CollectionView (billing 08), and its service credits (billing 19).
 * The Org Manager pays an open invoice from its page (screen 6.2).
 */
export const MoneyTab: React.FC<{
  contract: ContractDetail;
  scope: 'o' | 't';
  canPay: boolean;
}> = ({ contract, scope, canPay }) => {
  const navigate = useNavigate();
  const balance = useBalance(contract.id, true);
  const invoices = useInvoices(scope, { contractId: contract.id });
  const phone = !useMediaQuery('(min-width: 600px)', true);
  const figures: [string, string][] = balance.data
    ? [
        ['Due now', formatVnd(balance.data.dueNowVnd)],
        ['Due later', formatVnd(balance.data.dueLaterVnd)],
        ['Paid', formatVnd(balance.data.paidVnd)],
      ]
    : [];
  const invoicePath = (invoice: Invoice) =>
    scope === 'o' ? `/o/invoices/${invoice.id}` : `/t/billing?contractId=${contract.id}`;

  const fields: CollectionField<Invoice>[] = [
    {
      key: 'kind',
      label: 'Kind',
      render: (invoice) => invoice.kind,
      text: (invoice) => invoice.kind,
      hideWithPane: true,
    },
    {
      key: 'term',
      label: 'Term',
      render: (invoice) => (invoice.term ? `Term ${invoice.term.seq}` : 'None'),
      text: (invoice) => (invoice.term ? `Term ${invoice.term.seq}` : ''),
      hideWithPane: true,
    },
    {
      key: 'issued',
      label: 'Issued',
      render: (invoice) => formatDateTime(invoice.issuedAt),
      text: (invoice) => invoice.issuedAt,
      sortable: true,
      hideWithPane: true,
    },
    {
      key: 'total',
      label: 'Total',
      render: (invoice) => formatVnd(invoice.totalVnd),
      sortValue: (invoice) => invoice.totalVnd,
      align: 'end',
      sortable: true,
      compact: true,
    },
    {
      key: 'paid',
      label: 'Paid',
      render: (invoice) => formatVnd(invoice.paidVnd),
      sortValue: (invoice) => invoice.paidVnd,
      align: 'end',
    },
    {
      key: 'status',
      label: 'Status',
      render: (invoice) => INVOICE_STATUS[invoice.status],
      text: (invoice) => INVOICE_STATUS[invoice.status],
      compact: true,
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <Card padding="sm" aria-live="polite">
        <CardHeader title="Balance" />
        {balance.isLoading && <Loading />}
        {balance.error ? (
          <ErrorState error={balance.error} onRetry={() => void balance.refetch()} />
        ) : null}
        {balance.data && (
          <>
            {phone ? (
              // Below 600 px the three figures are one compact definition list (§10.5).
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-body">
                {figures.map(([label, value]) => (
                  <React.Fragment key={label}>
                    <dt className="text-ink-muted">{label}</dt>
                    <dd className="text-right font-semibold tabular-nums text-ink">{value}</dd>
                  </React.Fragment>
                ))}
              </dl>
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                {figures.map(([label, value]) => (
                  <StatCard key={label} label={label} value={value} />
                ))}
              </div>
            )}
            {balance.data.pendingDamageCharges.length > 0 && (
              <p className="mt-3 text-body-sm text-ink-muted">
                {balance.data.pendingDamageCharges.length} damage{' '}
                {balance.data.pendingDamageCharges.length === 1 ? 'charge waits' : 'charges wait'}{' '}
                for a TrekLink Admin.
              </p>
            )}
          </>
        )}
      </Card>

      <section aria-labelledby="money-invoices" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="money-invoices" className="text-title-sm text-ink">
            Invoices
          </h2>
          <Link
            to={
              scope === 'o'
                ? `/o/invoices?contractId=${contract.id}`
                : `/t/billing?contractId=${contract.id}`
            }
            className={`${LINK} inline-flex min-h-6 items-center text-body-sm`}
          >
            All invoices of {contract.code}
          </Link>
        </div>
        <CollectionView<Invoice>
          label={`Invoices of ${contract.code}`}
          items={invoices.data?.items}
          loading={invoices.isLoading}
          error={
            invoices.error ? (
              <ErrorState error={invoices.error} onRetry={() => void invoices.refetch()} />
            ) : undefined
          }
          itemId={(invoice) => invoice.id}
          itemName={(invoice) => invoice.number}
          itemHref={invoicePath}
          fields={fields}
          noun={{ one: 'invoice', other: 'invoices' }}
          itemActions={
            canPay
              ? [
                  {
                    key: 'pay',
                    label: 'Pay invoice',
                    icon: <CreditCard />,
                    allowed: (invoice) => invoice.paidVnd < invoice.totalVnd,
                    onSelect: (invoice) => navigate(invoicePath(invoice)),
                  },
                ]
              : []
          }
          details={{ href: invoicePath, hrefLabel: 'Open the invoice' }}
          emptyState={{
            title: 'No invoices yet.',
            description: 'Term 1 and its invoice are created with the request.',
          }}
        />
      </section>

      {contract.handedOverAt && <ServiceCreditsCard contractId={contract.id} />}
    </div>
  );
};
