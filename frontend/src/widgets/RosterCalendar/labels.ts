import type { RosterWarning } from '../../entities/organization/roster';

export type Gap = Extract<RosterWarning, { kind: 'NO_PRIMARY' }>;

export const dayLabel = (date: Date): string =>
  date.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });

const timeLabel = (date: Date): string => date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// "Tue 21 Oct 00:00 to 12:00", with the end's day when it differs from the start's.
export const windowLabel = (fromIso: string, toIso: string): string => {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  return `${dayLabel(from)} ${timeLabel(from)} to ${sameDay(from, to) ? '' : `${dayLabel(to)} `}${timeLabel(to)}`;
};

export const isGap = (warning: RosterWarning): warning is Gap => warning.kind === 'NO_PRIMARY';
