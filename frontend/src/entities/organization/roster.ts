import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../shared/api/apiClient';

export interface ShiftMember {
  memberId: string;
  fullName: string;
}

// A shift window as organizations api-design 16 to 18 return it.
export interface Shift {
  id: string;
  startsAt: string;
  endsAt: string;
  primary: ShiftMember | null;
  backup: ShiftMember | null;
}

// `NO_PRIMARY` carries its window (MSG22); `NO_BACKUP` comes with a saved shift only and the screen
// does not show it (screen 3.3 open point 3).
export type RosterWarning = { kind: 'NO_PRIMARY'; from: string; to: string } | { kind: 'NO_BACKUP' };

export interface Roster {
  shifts: Shift[];
  warnings: RosterWarning[];
}

export interface ShiftInput {
  startsAt: string;
  endsAt: string;
  primaryMemberId: string | null;
  backupMemberId: string | null;
}

export const rosterKeys = {
  all: (organizationId: string) => ['org-roster', organizationId] as const,
  week: (organizationId: string, from: string, to: string) => ['org-roster', organizationId, from, to] as const,
};

// organizations api-design 16. It refetches when the window regains focus, so a second Manager's
// edit shows up (screen 3.3).
export const useRoster = (organizationId: string | undefined, from: string, to: string) =>
  useQuery({
    queryKey: rosterKeys.week(organizationId ?? '', from, to),
    queryFn: () =>
      apiClient<Roster>(
        `/organizations/${organizationId}/roster?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ),
    enabled: Boolean(organizationId),
    refetchOnWindowFocus: true,
  });

type Saved = { shift: Shift; warnings: RosterWarning[] };

// organizations api-design 17.
export const createShift = (organizationId: string, input: ShiftInput) =>
  apiClient<Saved>(`/organizations/${organizationId}/roster`, { method: 'POST', body: JSON.stringify(input) });

// organizations api-design 18. On a started shift only `endsAt` may be sent, and not before now.
export const updateShift = (organizationId: string, shiftId: string, patch: Partial<ShiftInput>) =>
  apiClient<Saved>(`/organizations/${organizationId}/roster/${shiftId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });

// organizations api-design 19; a started shift answers 409 SHIFT_STARTED.
export const deleteShift = (organizationId: string, shiftId: string) =>
  apiClient<null>(`/organizations/${organizationId}/roster/${shiftId}`, { method: 'DELETE' });

export const hasStarted = (shift: Shift, now: Date = new Date()): boolean => new Date(shift.startsAt) <= now;

// Monday 00:00 of the viewer's week holding `day`.
export const weekStart = (day: Date): Date => {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
};

export const addDays = (day: Date, days: number): Date => {
  const next = new Date(day);
  next.setDate(next.getDate() + days);
  return next;
};

// The value of a datetime-local input, in the viewer's timezone.
export const toLocalInput = (iso: string): string => {
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

// A datetime-local value back to UTC with its zone, as RosterQueryDto and the shift DTOs require.
export const fromLocalInput = (value: string): string => new Date(value).toISOString();
