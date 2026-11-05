import type { EndPreview } from '../../entities/contract/api';
import { formatVnd } from '../../shared/lib/format';

// The words of the End contract now dialog (screen 5.2, D-097), from rentals api-design 31 only.

/** The credit line of the dialog, in words, from rentals api-design 31; nothing is computed here. */
export const creditText = (preview: EndPreview): string => {
  if (preview.planType === 'DAY') return 'No credit: a day plan is already billed per day.';
  if (preview.creditVnd === 0) return 'No credit: the current term is used to its last day.';
  const days = `${preview.unusedDays} unused ${preview.unusedDays === 1 ? 'day' : 'days'}`;
  const term = preview.term ? ` of term ${preview.term.seq} (${preview.termDays} days)` : '';
  return `${formatVnd(preview.creditVnd)} credited for ${days}${term}, on the closing invoice.`;
};

/** What is owed after the credit, and by whom (D-097 rule 3). */
export const owedText = (preview: EndPreview, viewer: 'staff' | 'manager', legalName: string) => {
  if (preview.owedToOrganizationVnd > 0) {
    const whom = viewer === 'manager' ? 'your organization' : legalName;
    return `TrekLink then owes ${whom} ${formatVnd(preview.owedToOrganizationVnd)}. It is refunded outside TrekLink.`;
  }
  return preview.outstandingVnd > 0
    ? `${formatVnd(preview.outstandingVnd)} is still to pay before the contract closes.`
    : 'Nothing is left to pay.';
};
