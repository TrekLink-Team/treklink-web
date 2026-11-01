import type { RosterWarning } from '../../entities/organization/roster';

export type Gap = Extract<RosterWarning, { kind: 'NO_PRIMARY' }>;

// The year shows only when it is not the current one, so "Mon 01 Nov 2027" cannot read as this year.
export const dayLabel = (date: Date, now: Date = new Date()): string => {
  const day = date.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
  return date.getFullYear() === now.getFullYear() ? day : `${day} ${date.getFullYear()}`;
};

const timeLabel = (date: Date): string => date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// "Tue 21 Oct 00:00 to 12:00", with the end's day when it differs from the start's, and a year on
// either day that is not in the current year.
export const windowLabel = (fromIso: string, toIso: string, now: Date = new Date()): string => {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  return `${dayLabel(from, now)} ${timeLabel(from)} to ${sameDay(from, to) ? '' : `${dayLabel(to, now)} `}${timeLabel(to)}`;
};

export const isGap = (warning: RosterWarning): warning is Gap => warning.kind === 'NO_PRIMARY';
