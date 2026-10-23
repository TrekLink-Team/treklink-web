import { remainingValue, wholeMonthsBetween } from './remaining-value';

const SCHEDULE = [
  { fromMonths: 0, valueVnd: 2500000 },
  { fromMonths: 12, valueVnd: 1800000 },
  { fromMonths: 24, valueVnd: 1200000 },
];
const acquired = new Date('2025-03-15T00:00:00Z');

describe('remaining value', () => {
  it('counts whole calendar months', () => {
    expect(wholeMonthsBetween(acquired, new Date('2025-04-14T23:59:59Z'))).toBe(0);
    expect(wholeMonthsBetween(acquired, new Date('2025-04-15T00:00:00Z'))).toBe(1);
    expect(wholeMonthsBetween(acquired, new Date('2025-01-01T00:00:00Z'))).toBe(0);
  });

  it('uses the first row at acquisition, a middle row mid-schedule, the last row past the end', () => {
    expect(remainingValue(SCHEDULE, acquired, acquired)).toBe(2500000);
    expect(remainingValue(SCHEDULE, acquired, new Date('2026-04-01T00:00:00Z'))).toBe(1800000);
    expect(remainingValue(SCHEDULE, acquired, new Date('2030-01-01T00:00:00Z'))).toBe(1200000);
  });

  it('does not depend on the order of the stored rows', () => {
    expect(
      remainingValue([...SCHEDULE].reverse(), acquired, new Date('2027-03-15T00:00:00Z')),
    ).toBe(1200000);
  });

  it('refuses a schedule without a month-0 row', () => {
    expect(() => remainingValue([{ fromMonths: 12, valueVnd: 1 }], acquired, acquired)).toThrow(
      RangeError,
    );
  });
});
