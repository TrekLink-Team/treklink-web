import { latestRentalDailyCutoff } from './rental-daily-cutoff';

describe('latestRentalDailyCutoff (fixed UTC+7)', () => {
  it.each([
    ['2026-10-29T17:00:00.000Z', 9, '2026-10-29T02:00:00.000Z'],
    ['2026-10-30T01:59:59.999Z', 9, '2026-10-29T02:00:00.000Z'],
    ['2026-10-30T02:00:00.000Z', 9, '2026-10-30T02:00:00.000Z'],
    ['2026-10-30T16:59:59.999Z', 9, '2026-10-30T02:00:00.000Z'],
    ['2026-10-30T17:00:00.000Z', 9, '2026-10-30T02:00:00.000Z'],
    ['2026-10-30T17:00:00.000Z', 0, '2026-10-30T17:00:00.000Z'],
    ['2026-10-30T16:00:00.000Z', 23, '2026-10-30T16:00:00.000Z'],
    ['2026-12-31T17:00:00.000Z', 9, '2026-12-31T02:00:00.000Z'],
  ])('%s at configured hour %s selects %s', (instant, hour, expected) => {
    expect(latestRentalDailyCutoff(new Date(instant), hour).toISOString()).toBe(expected);
  });

  it.each([-1, 24, 9.5, Number.NaN])('rejects an invalid configured hour %s', (hour) => {
    expect(() => latestRentalDailyCutoff(new Date('2026-10-30T02:00:00Z'), hour)).toThrow(
      RangeError,
    );
  });
});
