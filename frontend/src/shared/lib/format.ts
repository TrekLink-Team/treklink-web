// Display formats of chapter 06 §8.8: VND with thousands separators, times in the viewer's timezone.

const VND = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export const formatVnd = (amount: number): string => `${VND.format(amount)} VND`;

// A calendar date as the server sends it (yyyy-mm-dd), shown without a timezone shift.
export const formatDay = (day: string): string => {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

// An instant in the viewer's timezone; the zone itself is in the title attribute where shown.
export const formatDateTime = (iso: string): string =>
  new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

// An instant in UTC with its zone named once, for a hover over a time shown in the viewer's timezone.
export const formatUtc = (iso: string): string =>
  `${new Date(iso).toLocaleString('en-GB', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })} UTC`;

// Free text from the server with instants in it, such as "Handover appointment
// 2026-10-28T02:00:00.000Z" in a contract's history, with each instant shown as formatDateTime.
export const formatInstantsIn = (text: string): string =>
  text.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z/g, (iso) =>
    formatDateTime(iso),
  );

export const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

export const viewerTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

// Today in the viewer's calendar as yyyy-mm-dd, the floor of a date input.
export const todayDay = (now: Date = new Date()): string => {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};
