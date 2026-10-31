import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AUDIT_PAGE_SIZE, fetchSyncAudit, syncAuditKeys } from './api';

const api = vi.fn();
vi.mock('../../shared/api/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../shared/api/apiClient')>()),
  apiClient: (...args: unknown[]) => api(...args),
}));

beforeEach(() => api.mockReset().mockResolvedValue({ items: [] }));

const bodyOf = (call: unknown[]) => JSON.parse((call[1] as { body: string }).body) as unknown;

describe('fetchSyncAudit (gateway-sync api-design 04)', () => {
  it('posts listAudit with the page and the client page size, and no outcome for every outcome', async () => {
    await fetchSyncAudit({ pageNumber: 3 });
    expect(api.mock.calls[0][0]).toBe('/gateway-sync');
    expect((api.mock.calls[0][1] as { method: string }).method).toBe('POST');
    expect(bodyOf(api.mock.calls[0])).toEqual({
      op: 'listAudit',
      pageNumber: 3,
      pageSize: AUDIT_PAGE_SIZE,
    });
  });

  it('sends one outcome as a list', async () => {
    await fetchSyncAudit({ outcome: 'NORMALIZATION_FAILED', pageNumber: 1 });
    expect(bodyOf(api.mock.calls[0])).toMatchObject({ outcome: ['NORMALIZATION_FAILED'] });
  });

  it('keys each filter and page apart, under the sync-status key the page refreshes', () => {
    expect(syncAuditKeys.page({ pageNumber: 1 })).toEqual(['sync-status', 'audit', 'all', 1]);
    expect(syncAuditKeys.page({ outcome: 'MALFORMED_ENVELOPE', pageNumber: 2 })).toEqual([
      'sync-status',
      'audit',
      'MALFORMED_ENVELOPE',
      2,
    ]);
    expect(syncAuditKeys.all).toEqual(['sync-status', 'audit']);
  });
});
