// Remaining value of a device by age (devices task 1.3, FR-BILL-05). The schedule is the variant's
// `remainingValueSchedule`: rows `{ fromMonths, valueVnd }`; the row with the largest `fromMonths` at or
// below the device's age in whole months applies.

export interface RemainingValueStep {
  fromMonths: number;
  valueVnd: number;
}

// Whole calendar months from `from` to `to`, never negative.
export const wholeMonthsBetween = (from: Date, to: Date): number => {
  let months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  const dayOfMonth = (d: Date) => d.getTime() - Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  if (dayOfMonth(to) < dayOfMonth(from)) months -= 1;
  return Math.max(0, months);
};

export const remainingValue = (
  schedule: readonly RemainingValueStep[],
  acquiredAt: Date,
  at: Date,
): number => {
  const age = wholeMonthsBetween(acquiredAt, at);
  const step = [...schedule]
    .sort((a, b) => b.fromMonths - a.fromMonths)
    .find((row) => row.fromMonths <= age);
  if (!step) throw new RangeError('remaining value schedule has no row for month 0');
  return step.valueVnd;
};
