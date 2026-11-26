import type { InvoiceFilters } from '../../entities/billing/api';
import { isDay } from '../../entities/report/model';

// What the three figures mean (#501). With a period they are the revenue report's columns, so the
// list can be set beside a report row; without one they cover every line of the listed invoices, and
// Outstanding counts each contract on its own, as the overview's Still due does (#512).
export const TOTALS_LEGEND_PERIOD =
  'Invoiced = invoice lines due in the period; Paid = received against them; Outstanding = the difference.';
export const TOTALS_LEGEND_ALL =
  'Invoiced = every line of the listed invoices; Paid = received against them; Outstanding = what each contract still owes on them, so a credit lowers only its own contract.';

// The filters a link can carry (`?contractId=&hardwareVariantId=&from=&to=`): the contract a contract
// page linked from, and the variant and period a revenue report row links with (#501). A malformed
// day is dropped, and a period needs both ends in order.
export const invoiceFiltersFromParams = (params: URLSearchParams): InvoiceFilters => {
  const from = params.get('from');
  const to = params.get('to');
  const period = isDay(from) && isDay(to) && from < to ? { from, to } : {};
  return {
    pageNumber: 1,
    contractId: params.get('contractId') ?? undefined,
    hardwareVariantId: params.get('hardwareVariantId') ?? undefined,
    ...period,
  };
};
