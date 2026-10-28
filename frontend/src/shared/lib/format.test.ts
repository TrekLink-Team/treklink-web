import { describe, expect, it } from 'vitest';
import { formatDateTime, formatInstantsIn } from './format';

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
