const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const VIETNAM_OFFSET_MS = 7 * HOUR_MS;

// The most recent configured daily batch boundary, in fixed UTC+7. Hourly wakeups may catch up
// older batches, but must not process items that became due after this boundary.
export const latestRentalDailyCutoff = (at: Date, hourLocal: number): Date => {
  if (!Number.isInteger(hourLocal) || hourLocal < 0 || hourLocal > 23) {
    throw new RangeError('rentals.termRolloverHourLocal must be an integer from 0 to 23.');
  }
  const localDay = Math.floor((at.getTime() + VIETNAM_OFFSET_MS) / DAY_MS);
  const today = localDay * DAY_MS + hourLocal * HOUR_MS - VIETNAM_OFFSET_MS;
  return new Date(today > at.getTime() ? today - DAY_MS : today);
};

// The term end that makes the next rollover close a term at once: one minute before the latest daily
// cutoff, never in the future and at most a day ago. Used by the demo time shift of MF-05
// (`prisma/demo-term-end.ts` and the demo module's `term-ended` scenario, D-088).
export const rolloverTermEnd = (now: Date, hourLocal: number): Date =>
  new Date(latestRentalDailyCutoff(now, hourLocal).getTime() - 60_000);
