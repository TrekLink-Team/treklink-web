import { AUTH_EVENT_TYPES, type AuthEventFilters, type AuthEventType } from './api';

// The filters live in the URL query (screen 7.3), so a link reproduces the view. They hold ids and
// enum values only, never personal data.
const KEYS = ['userId', 'organizationId', 'type', 'from', 'to'] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Security signals: the badge is critical-toned and carries its text (convention 06 §8 item 3).
export const SECURITY_SIGNALS: ReadonlySet<AuthEventType> = new Set([
  'TOKEN_REUSE_DETECTED',
  'ACCOUNT_LOCKED',
]);

export const isEventType = (value: string): value is AuthEventType =>
  (AUTH_EVENT_TYPES as readonly string[]).includes(value);

export const filtersOf = (params: URLSearchParams): AuthEventFilters => {
  const filters: AuthEventFilters = {};
  for (const key of KEYS) {
    const value = params.get(key)?.trim();
    if (!value) continue;
    if (key === 'type') {
      if (isEventType(value)) filters.type = value;
    } else {
      filters[key] = value;
    }
  }
  return filters;
};

export const paramsOf = (filters: AuthEventFilters): URLSearchParams => {
  const params = new URLSearchParams();
  for (const key of KEYS) {
    const value = filters[key]?.trim();
    if (value) params.set(key, value);
  }
  return params;
};

export const hasFilters = (filters: AuthEventFilters): boolean => Object.keys(filters).length > 0;

export interface FilterErrors {
  userId?: string;
  to?: string;
}

// What the filter bar blocks before it sends a request (MSG35 for the period). The server checks the
// same; auth 17 sets no maximum period.
export const filterErrors = (filters: AuthEventFilters): FilterErrors => {
  const errors: FilterErrors = {};
  if (filters.userId && !UUID.test(filters.userId)) errors.userId = 'Account id must be a UUID.';
  if (filters.from && filters.to && Date.parse(filters.from) >= Date.parse(filters.to)) {
    errors.to = 'Choose an end after the start.';
  }
  return errors;
};
