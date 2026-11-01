import { describe, expect, it } from 'vitest';
import { dayLabel, windowLabel } from './labels';

const now = new Date(2026, 10, 1, 13, 0);

describe('roster labels', () => {
  it('leaves the year out for a day in the current year', () => {
    expect(dayLabel(new Date(2026, 10, 2), now)).toBe('Mon 02 Nov');
  });

  it('names the year of a day in another year', () => {
    expect(dayLabel(new Date(2027, 10, 1), now)).toBe('Mon 01 Nov 2027');
  });

  it('names the year of a window end in the next year', () => {
    expect(windowLabel(new Date(2026, 10, 1, 8).toISOString(), new Date(2027, 10, 1, 8).toISOString(), now)).toBe(
      'Sun 01 Nov 08:00 to Mon 01 Nov 2027 08:00',
    );
  });
});
