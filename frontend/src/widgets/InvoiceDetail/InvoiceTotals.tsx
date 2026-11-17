import React from 'react';
import type { InvoiceFilters, InvoiceListTotals } from '../../entities/billing/api';
import { formatVnd } from '../../shared/lib/format';
import { TOTALS_LEGEND_ALL, TOTALS_LEGEND_PERIOD } from './invoice-list';

// Invoiced, paid and outstanding over every invoice the filters match, not the page on screen: the
// server adds them up (billing api-design 08, `totals`).
export const InvoiceTotals: React.FC<{ totals: InvoiceListTotals | undefined; filters: InvoiceFilters }> = ({
  totals,
  filters,
}) =>
  totals ? (
    <div className="mb-4" data-testid="invoice-totals">
      <dl className="flex flex-wrap gap-x-8 gap-y-2">
        {(
          [
            ['Invoiced', totals.invoicedVnd],
            ['Paid', totals.paidVnd],
            ['Outstanding', totals.outstandingVnd],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <dt className="text-body-sm text-ink-muted">{label}</dt>
            <dd className="text-lg font-semibold tabular-nums">{formatVnd(value)}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-body-sm text-ink-muted">
        {filters.from && filters.to ? TOTALS_LEGEND_PERIOD : TOTALS_LEGEND_ALL}
      </p>
    </div>
  ) : null;
