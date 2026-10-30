import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../shared/api/apiClient';
import { queryString, type Page } from '../../shared/api/query';
import type { ContractStatus, IncidentState } from '../../shared/ui/status';
import type { Incident } from './api';

// Authority reports as incidents api-design 09 to 11 return them (screen 8.3). Open or Closed comes
// from `caseClosedAt`; a report has no status of its own.
export interface AuthorityReport {
  id: string;
  incidentId: string | null;
  contractId: string | null;
  agency: string;
  reference: string;
  reportedAt: string;
  caseClosedAt: string | null;
}

export interface CaseClosure {
  id: string;
  caseClosedAt: string;
  incidentState: IncidentState | null;
}

export interface ReportInput {
  agency: string;
  reference: string;
  reportedAt: string;
  note?: string;
}

// The fields of a defaulted contract the subject selector shows (rentals api-design 02 and 03).
// Read here, not through the contract entity, because one entity never imports another's API.
export interface ReportableContract {
  id: string;
  code: string;
  status: ContractStatus;
  organization: { legalName: string } | null;
}

export const PAGE_SIZE = 20;

// Screen 8.3 keys. The report list sits under ['authority-reports'], so one invalidation refreshes
// every page and filter.
export const authorityReportKeys = {
  all: ['authority-reports'] as const,
  list: (openOnly: boolean, pageNumber: number) =>
    ['authority-reports', 'fleet', openOnly, pageNumber, PAGE_SIZE] as const,
  contract: (id: string) => ['contract', 'fleet', id] as const,
};

// `open=true` reads open cases only; unchecked omits `open`, never `open=false` (screen 8.3).
export const fetchAuthorityReports = (openOnly: boolean, pageNumber: number) =>
  apiClient<Page<AuthorityReport>>(
    `/authority-reports${queryString({ open: openOnly ? true : undefined, pageNumber, pageSize: PAGE_SIZE })}`,
  );

export const useAuthorityReports = (openOnly: boolean, pageNumber: number) =>
  useQuery({
    queryKey: authorityReportKeys.list(openOnly, pageNumber),
    queryFn: () => fetchAuthorityReports(openOnly, pageNumber),
  });

export const fetchDefaultedContracts = (pageNumber: number) =>
  apiClient<Page<ReportableContract>>(
    `/contracts${queryString({ status: 'DEFAULTED', pageNumber, pageSize: PAGE_SIZE })}`,
  );

export const fetchReportableContract = (id: string) =>
  apiClient<ReportableContract>(`/contracts/${id}`);

const post = <T>(endpoint: string, body: object): Promise<T> =>
  apiClient<T>(endpoint, { method: 'POST', body: JSON.stringify(body) });

const withoutEmptyNote = <T extends { note?: string }>(input: T): T =>
  input.note?.trim() ? { ...input, note: input.note.trim() } : { ...input, note: undefined };

// api-design 08. Returns the incident, not the report; the list is refetched after it.
export const reportIncident = (id: string, input: ReportInput, expectedVersion: number) =>
  post<Incident>(`/incidents/${id}/authority-reports`, {
    ...withoutEmptyNote(input),
    expectedVersion,
  });

// api-design 10. The contract state does not change.
export const reportContract = (contractId: string, input: ReportInput) =>
  post<AuthorityReport>('/authority-reports', { ...withoutEmptyNote(input), contractId });

// api-design 09. A still REPORTED incident moves to CLOSED; any other keeps its state.
export const closeCase = (reportId: string, closedAt: string, note?: string) =>
  post<CaseClosure>(
    `/authority-reports/${reportId}/close-case`,
    withoutEmptyNote({ closedAt, note }),
  );

export const REPORTABLE_STATES: readonly IncidentState[] = ['UNROUTED', 'ESCALATED'];

export const isReportable = (incident: Pick<Incident, 'state'>) =>
  REPORTABLE_STATES.includes(incident.state);

// A datetime-local value, in the viewer's timezone, as the UTC instant the API takes.
export const instantOf = (local: string): string => new Date(local).toISOString();
