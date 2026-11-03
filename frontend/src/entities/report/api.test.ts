import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../shared/api/apiClient';
import { fetchReport, fetchReportCsv, REPORT_KINDS, reportKeys } from './api';

vi.mock('../../shared/api/apiClient', () => ({ apiClient: vi.fn() }));

describe('the reports read (monitoring api-design 08)', () => {
  beforeEach(() => vi.mocked(apiClient).mockReset());

  it('sends the kind in the path and the period as dates', async () => {
    await fetchReport('incident-times', '2026-10-01', '2026-11-01');
    expect(vi.mocked(apiClient).mock.calls[0][0]).toBe(
      '/reports/incident-times?from=2026-10-01&to=2026-11-01',
    );
  });

  it('asks for the server file with format=csv', async () => {
    await fetchReportCsv('revenue', '2026-10-01', '2026-11-01');
    expect(vi.mocked(apiClient).mock.calls[0][0]).toBe(
      '/reports/revenue?from=2026-10-01&to=2026-11-01&format=csv',
    );
  });

  it('keys a query by kind and period, and lists the five kinds in tab order', () => {
    expect(reportKeys.of('lost', '2026-10-01', '2026-11-01')).toEqual([
      'reports',
      'lost',
      '2026-10-01',
      '2026-11-01',
    ]);
    expect(REPORT_KINDS).toEqual(['utilization', 'revenue', 'overdue', 'lost', 'incident-times']);
  });
});
