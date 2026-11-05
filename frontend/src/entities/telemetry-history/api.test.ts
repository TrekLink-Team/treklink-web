import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../shared/api/apiClient';
import { fetchHistory, fetchHistoryCsv, historyKeys, periodError } from './api';

vi.mock('../../shared/api/apiClient', () => ({ apiClient: vi.fn() }));

const FROM = '2026-10-20T00:00:00.000Z';
const TO = '2026-10-21T00:00:00.000Z';

describe('periodError (MSG35)', () => {
  it('accepts a period of one second up to the server limit', () => {
    expect(periodError(FROM, '2026-10-20T00:00:01.000Z', 7)).toBeNull();
    expect(periodError(FROM, '2026-10-27T00:00:00.000Z', 7)).toBeNull();
    expect(periodError(FROM, '2026-11-03T00:00:00.000Z', 14)).toBeNull();
  });

  it('refuses an empty, reversed or too long period, and a date that is not one', () => {
    const message = 'Choose an end after the start, at most 7 days later.';
    expect(periodError(FROM, FROM, 7)).toBe(message);
    expect(periodError(TO, FROM, 7)).toBe(message);
    expect(periodError(FROM, '2026-10-27T00:00:00.001Z', 7)).toBe(message);
    expect(periodError('', '', 7)).toBe(message);
    expect(periodError(FROM, '2026-11-03T00:00:00.001Z', 14)).toBe(
      'Choose an end after the start, at most 14 days later.',
    );
  });

  it('checks only the order before the server has named its limit', () => {
    expect(periodError(FROM, '2026-12-20T00:00:00.000Z', null)).toBeNull();
    expect(periodError(TO, FROM, null)).toBe('Choose an end after the start.');
  });
});

describe('the history reads (monitoring api-design 03)', () => {
  beforeEach(() => vi.mocked(apiClient).mockReset());

  it('sends no kind for both kinds and one kind for a single one', async () => {
    await fetchHistory('d-1', { from: FROM, to: TO, kinds: ['POSITION', 'TELEMETRY'] });
    await fetchHistory('d-1', { from: FROM, to: TO, kinds: ['TELEMETRY'] });
    const urls = vi.mocked(apiClient).mock.calls.map((call) => call[0]);
    expect(urls[0]).toBe(
      '/telemetry/devices/d-1/history?from=2026-10-20T00%3A00%3A00.000Z&to=2026-10-21T00%3A00%3A00.000Z',
    );
    expect(urls[1]).toContain('&kind=TELEMETRY');
  });

  it('asks for the CSV text with format=csv', async () => {
    vi.mocked(apiClient).mockResolvedValue('at,kind');
    await expect(
      fetchHistoryCsv('d-1', { from: FROM, to: TO, kinds: ['POSITION', 'TELEMETRY'] }),
    ).resolves.toBe('at,kind');
    expect(vi.mocked(apiClient).mock.calls[0][0]).toContain('&format=csv');
  });

  it('keys a query by device, period and kinds', () => {
    expect(historyKeys.range('d-1', { from: FROM, to: TO, kinds: ['POSITION'] })).toEqual([
      'telemetry-history',
      'd-1',
      FROM,
      TO,
      'POSITION',
    ]);
  });
});
