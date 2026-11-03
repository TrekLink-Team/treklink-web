import { REPORT_KINDS, type IncidentTimesRow, type ReportKind, type RevenueRow } from './api';

export const KIND_LABEL: Record<ReportKind, string> = {
  utilization: 'Utilization',
  revenue: 'Revenue',
  overdue: 'Overdue contracts',
  lost: 'Lost units',
  'incident-times': 'Incident times',
};

export const isReportKind = (value: string | null): value is ReportKind =>
  REPORT_KINDS.some((kind) => kind === value);

// The longest period one report may cover: `monitoring.reportMaxRangeDays` (366 by default, 1 to 732). Staff
// cannot read the parameter, so the page uses the default and shows the server's 400 as the backstop.
export const REPORT_MAX_DAYS = 366;

const DAY_MS = 86_400_000;
const pad = (value: number) => String(value).padStart(2, '0');

// A calendar day as `YYYY-MM-DD`, in the viewer's calendar.
export const dayOf = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const parseDay = (day: string): Date | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return dayOf(date) === day ? date : null;
};

export const isDay = (value: string | null): value is string =>
  value !== null && parseDay(value) !== null;

export const addDays = (day: string, days: number): string => {
  const date = parseDay(day);
  if (!date) return day;
  date.setDate(date.getDate() + days);
  return dayOf(date);
};

export interface Period {
  // Inclusive, as the API takes it.
  from: string;
  // Exclusive, as the API takes it. The form shows the day before.
  to: string;
}

// The current calendar month, a month back for `offset` -1.
export const monthPeriod = (now: Date, offset = 0): Period => {
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1);
  return { from: dayOf(start), to: dayOf(end) };
};

// The last `days` days including today.
export const lastDaysPeriod = (now: Date, days: number): Period => {
  const today = dayOf(now);
  return { from: addDays(today, 1 - days), to: addDays(today, 1) };
};

// MSG35: the period is missing, reversed or longer than the limit. `lastDay` is the last included day the
// form shows; the API takes the day after it. Returns the message, or null when the period is fine.
export const periodError = (from: string, lastDay: string): string | null => {
  const start = parseDay(from);
  const end = parseDay(lastDay);
  const message = `Choose an end after the start, at most ${REPORT_MAX_DAYS} days later.`;
  if (!start || !end) return message;
  const span = (end.getTime() - start.getTime()) / DAY_MS + 1;
  return span >= 1 && span <= REPORT_MAX_DAYS ? null : message;
};

export const csvName = (kind: ReportKind, from: string, to: string): string =>
  `treklink-${kind}-${from}-${to}.csv`;

// Seconds as "42 s" or "14 min"; a missing figure is a dash.
export const durationText = (seconds: number | null): string => {
  if (seconds === null) return '–';
  if (seconds < 60) return `${seconds} s`;
  return `${Math.round(seconds / 60)} min`;
};

export const revenueTotals = (rows: readonly RevenueRow[]) =>
  rows.reduce(
    (total, row) => ({
      invoicedVnd: total.invoicedVnd + row.invoicedVnd,
      paidVnd: total.paidVnd + row.paidVnd,
      outstandingVnd: total.outstandingVnd + row.outstandingVnd,
    }),
    { invoicedVnd: 0, paidVnd: 0, outstandingVnd: 0 },
  );

export const ALL_ORGANIZATIONS = 'All organizations';

// The row the tiles show on load: the one over every incident of the period, else the organization
// with the most incidents.
export const defaultIncidentRow = (
  rows: readonly IncidentTimesRow[],
): IncidentTimesRow | undefined =>
  rows.find((row) => row.organization === null) ??
  [...rows].sort((a, b) => b.incidents - a.incidents)[0];

export const incidentRowName = (row: IncidentTimesRow): string =>
  row.organization ?? ALL_ORGANIZATIONS;
