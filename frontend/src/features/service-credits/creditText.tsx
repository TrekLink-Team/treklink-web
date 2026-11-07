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

// The outage of a fault credit, or the release a release credit pays for (D-099).
export const outageText = (credit: ServiceCredit): string => {
  if (credit.kind === 'RELEASE' || !credit.outageFrom || !credit.outageTo) {
    return credit.release
      ? `Released ${formatDateTime(credit.release.releasedAt)}: ${credit.release.reason}`
      : 'Released';
  }
  const days = credit.outageDays ?? 0;
  return `${formatDateTime(credit.outageFrom)} to ${formatDateTime(credit.outageTo)}, ${days} ${
    days === 1 ? 'day' : 'days'
  }`;
};
