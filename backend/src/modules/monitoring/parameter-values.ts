// A business parameter read as a JSON value is only trusted once it is a finite number. Shared by the
// monitoring reads that apply a threshold, so the live map and the system health refuse a malformed
// value the same way.
export const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
