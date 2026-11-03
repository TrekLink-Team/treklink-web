import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../shared/api/apiClient';
import { queryString } from '../../shared/api/query';

// The reports as monitoring api-design 08 returns them (screen 9.4). TrekLink Staff and Admin.
export const REPORT_KINDS = [
  'utilization',
  'revenue',
  'overdue',
  'lost',
  'incident-times',
] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export interface UtilizationRow {
  variant: string | null;
  unitsInService: number;
  rentedUnitDays: number;
  availableUnitDays: number;
  utilizationPct: number;
}

export interface RevenueRow {
  variant: string | null;
  invoicedVnd: number;
  paidVnd: number;
  outstandingVnd: number;
}

export interface OverdueRow {
  contractId: string;
  contractCode: string;
  organization: string;
  endDate: string;
  daysOverdue: number;
  unitsOut: number;
  lateFeeVnd: number;
  state: string;
}

export interface LostRow {
  lossCaseId: string | null;
  assetTag: string | null;
  variant: string | null;
  organization: string;
  contractId: string;
  contractCode: string;
  lostAt: string;
  lossCaseState: string | null;
  chargeVnd: number | null;
}

export interface IncidentTimesRow {
  // Null for the row over every incident of the period.
  organization: string | null;
  incidents: number;
  ackMedianSec: number | null;
  ackP95Sec: number | null;
  resolveMedianSec: number | null;
  resolveP95Sec: number | null;
}

export interface ReportRows {
  utilization: UtilizationRow[];
  revenue: RevenueRow[];
  overdue: OverdueRow[];
  lost: LostRow[];
  'incident-times': IncidentTimesRow[];
}

export interface Report<K extends ReportKind = ReportKind> {
  kind: K;
  from: string;
  to: string;
  rows: ReportRows[K];
}

export const reportKeys = {
  all: ['reports'] as const,
  of: (kind: ReportKind, from: string, to: string) => ['reports', kind, from, to] as const,
};

// `from` inclusive and `to` exclusive, both `YYYY-MM-DD`.
export const fetchReport = <K extends ReportKind>(kind: K, from: string, to: string) =>
  apiClient<Report<K>>(`/reports/${kind}${queryString({ from, to })}`);

// `format=csv` answers the CSV text in the envelope's `result`: the server's file is the export, so what
// is downloaded equals what the report states.
export const fetchReportCsv = (kind: ReportKind, from: string, to: string) =>
  apiClient<string>(`/reports/${kind}${queryString({ from, to, format: 'csv' })}`);

// A past range does not change while the screen is open (screen 9.4: stale time 5 minutes).
export const useReport = <K extends ReportKind>(
  kind: K,
  from: string,
  to: string,
  enabled = true,
) =>
  useQuery({
    queryKey: reportKeys.of(kind, from, to),
    queryFn: () => fetchReport(kind, from, to),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
    enabled,
  });
