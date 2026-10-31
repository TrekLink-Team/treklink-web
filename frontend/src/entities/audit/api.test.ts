import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../shared/api/apiClient';
import { auditKeys, fetchAuditLogs } from './api';

vi.mock('../../shared/api/apiClient', () => ({ apiClient: vi.fn() }));

describe('the audit log read (platform api-design 05)', () => {
  beforeEach(() => vi.mocked(apiClient).mockReset());

  it('sends only the filters that are set, with the page and 20 to a page', async () => {
    await fetchAuditLogs({ action: 'parameter.', subjectId: 'monitoring.historyMaxRangeDays' }, 2);
    expect(vi.mocked(apiClient).mock.calls[0][0]).toBe(
      '/audit-logs?action=parameter.&subjectId=monitoring.historyMaxRangeDays&pageNumber=2&pageSize=20',
    );
  });

  it('reads the first page of an unfiltered log', async () => {
    await fetchAuditLogs({}, 1);
    expect(vi.mocked(apiClient).mock.calls[0][0]).toBe('/audit-logs?pageNumber=1&pageSize=20');
  });

  it('keys a query by its filters and its page', () => {
    expect(auditKeys.list({ action: 'x.' }, 3)).toEqual(['audit-logs', { action: 'x.' }, 3]);
  });
});
