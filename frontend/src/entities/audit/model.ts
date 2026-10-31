import type { AuditFilters } from './api';

// The filters of the change log live in the URL query (screen 7.4), so a link from another screen, such
// as the Changes link of a parameter, opens the log already filtered.
const KEYS = ['actorId', 'organizationId', 'subjectType', 'subjectId', 'action', 'from', 'to'] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const filtersOf = (params: URLSearchParams): AuditFilters =>
  Object.fromEntries(
    KEYS.flatMap((key) => {
      const value = params.get(key)?.trim();
      return value ? [[key, value]] : [];
    }),
  ) as AuditFilters;

export const paramsOf = (filters: AuditFilters): URLSearchParams => {
  const params = new URLSearchParams();
  for (const key of KEYS) {
    const value = filters[key]?.trim();
    if (value) params.set(key, value);
  }
  return params;
};

export const pageOf = (params: URLSearchParams): number => {
  const page = Number(params.get('page'));
  return Number.isInteger(page) && page >= 1 ? page : 1;
};

export const hasFilters = (filters: AuditFilters): boolean => Object.keys(filters).length > 0;

export interface FilterErrors {
  actorId?: string;
  to?: string;
}

// What the filter bar blocks before it sends a request. The server checks the same.
export const filterErrors = (filters: AuditFilters): FilterErrors => {
  const errors: FilterErrors = {};
  if (filters.actorId && !UUID.test(filters.actorId)) errors.actorId = 'Actor id must be a UUID.';
  if (filters.from && filters.to && Date.parse(filters.from) >= Date.parse(filters.to)) {
    errors.to = 'Choose an end after the start.';
  }
  return errors;
};

const pad = (value: number) => String(value).padStart(2, '0');

// The value a `datetime-local` input holds: the viewer's local time without a zone.
export const toLocalInput = (iso: string | undefined): string => {
  if (!iso || Number.isNaN(Date.parse(iso))) return '';
  const date = new Date(iso);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

// The instant a `datetime-local` value means as ISO 8601 UTC, or undefined for an empty or invalid one.
export const fromLocalInput = (value: string): string | undefined => {
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime()) ? date.toISOString() : undefined;
};

// A snapshot as indented text for the before and after blocks.
export const snapshotText = (value: unknown): string =>
  value === null || value === undefined ? '–' : (JSON.stringify(value, null, 2) ?? '–');
