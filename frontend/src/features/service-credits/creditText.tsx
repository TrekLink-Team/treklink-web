import React from 'react';
import type { ServiceCredit } from '../../entities/billing/api';
import { formatDateTime, formatVnd } from '../../shared/lib/format';

// The amount a credit is worth now: the decided amount once an Admin decided, else the computed one.
export const creditAmount = (credit: ServiceCredit): React.ReactNode => (
  <span className="flex flex-col items-end">
    <span>{formatVnd(credit.decidedVnd ?? credit.computedVnd)}</span>
    {credit.decidedVnd !== null && credit.decidedVnd !== credit.computedVnd && (
      <span className="text-body-sm text-ink-muted">computed {formatVnd(credit.computedVnd)}</span>
    )}
    {credit.status === 'APPROVED' && credit.appliedVnd > 0 && (
      <span className="text-body-sm text-ink-muted">
        {formatVnd(credit.appliedVnd)} on invoices
      </span>
    )}
  </span>
);

export const outageText = (credit: ServiceCredit): string =>
  `${formatDateTime(credit.outageFrom)} to ${formatDateTime(credit.outageTo)}, ${credit.outageDays} ${
    credit.outageDays === 1 ? 'day' : 'days'
  }`;
