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
