import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../shared/api/apiClient';
import { queryString, type Page } from '../../shared/api/query';

// Business parameters and their change history as platform api-design 02 to 04 return them (screen 7.4).
export type ParameterType = 'INT' | 'DURATION_SECONDS' | 'DECIMAL' | 'PERCENT' | 'JSON';

export interface Parameter {
  key: string;
  value: unknown;
  valueType: ParameterType;
  // Absent for a type with no declared range, such as JSON.
  bounds: { min?: number; max?: number } | null;
  unit: string | null;
  ownerModule: string;
  description: string;
  // The version the row loaded with, sent back as `expectedVersion` when it is edited.
  version: number;
  updatedAt: string;
}

export interface ParameterHistoryItem {
  previousValue: unknown;
  newValue: unknown;
  changedBy: { id: string; fullName: string } | null;
  reason: string | null;
  changedAt: string;
}

export interface ParameterChange {
  value: unknown;
  expectedVersion: number;
  reason?: string;
}

// One page holds the whole registry (about sixty parameters, MAX_PAGE_SIZE is 100); the screen groups
// them by module and filters in the client.
export const PARAMETERS_PAGE_SIZE = 100;
export const HISTORY_PAGE_SIZE = 10;

export const parameterKeys = {
  all: ['parameters'] as const,
  list: ['parameters', 'all', 1] as const,
  history: (key: string, pageNumber: number) => ['parameter-history', key, pageNumber] as const,
  historyOf: (key: string) => ['parameter-history', key] as const,
};

export const fetchParameters = () =>
  apiClient<Page<Parameter>>(`/parameters${queryString({ pageSize: PARAMETERS_PAGE_SIZE })}`);

export const useParameters = () =>
  useQuery({ queryKey: parameterKeys.list, queryFn: fetchParameters, retry: false });

export const fetchParameterHistory = (key: string, pageNumber: number) =>
  apiClient<Page<ParameterHistoryItem>>(
    `/parameters/${encodeURIComponent(key)}/history${queryString({
      pageNumber,
      pageSize: HISTORY_PAGE_SIZE,
    })}`,
  );

export const useParameterHistory = (key: string, pageNumber: number) =>
  useQuery({
    queryKey: parameterKeys.history(key, pageNumber),
    queryFn: () => fetchParameterHistory(key, pageNumber),
    retry: false,
  });

export const updateParameter = (key: string, change: ParameterChange) =>
  apiClient<Parameter>(`/parameters/${encodeURIComponent(key)}`, {
    method: 'PATCH',
    body: JSON.stringify(change),
  });
