import { describe, expect, it } from 'vitest';
import { formatDateTime, formatInstantsIn, formatTime } from './format';

describe('formatTime', () => {
  it('shows the time of day to the second in the viewer timezone', () => {
    expect(formatTime(new Date(2026, 10, 15, 9, 5, 7))).toBe('09:05:07');
  });

  it('takes the milliseconds a query reports as its update time', () => {
    const at = new Date(2026, 10, 15, 23, 0, 1);
    expect(formatTime(at.getTime())).toBe('23:00:01');
  });
});

describe('formatInstantsIn', () => {
  it('shows an instant inside history text in the viewer timezone', () => {
    const iso = '2026-10-28T02:00:00.000Z';
    expect(formatInstantsIn(`Handover appointment ${iso}`)).toBe(
      `Handover appointment ${formatDateTime(iso)}`,
    );
  });

  it('leaves text without an instant unchanged', () => {
    expect(formatInstantsIn('Trip postponed to next month.')).toBe('Trip postponed to next month.');
  });
});
