import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../shared/api/apiClient';
import { fetchParameterHistory, fetchParameters, updateParameter } from './api';

vi.mock('../../shared/api/apiClient', () => ({ apiClient: vi.fn() }));

describe('the parameter reads (platform api-design 02 to 04)', () => {
  beforeEach(() => vi.mocked(apiClient).mockReset());

  it('reads the whole registry in one page', async () => {
    await fetchParameters();
    expect(vi.mocked(apiClient).mock.calls[0][0]).toBe('/parameters?pageSize=100');
  });

  it('reads the history of a key, encoded, ten to a page', async () => {
    await fetchParameterHistory('incidents.primaryAckTimeoutSeconds', 2);
    expect(vi.mocked(apiClient).mock.calls[0][0]).toBe(
      '/parameters/incidents.primaryAckTimeoutSeconds/history?pageNumber=2&pageSize=10',
    );
  });

  it('patches the value with the version it loaded with', async () => {
    await updateParameter('incidents.primaryAckTimeoutSeconds', {
      value: 90,
      expectedVersion: 3,
      reason: 'Faster demo',
    });
    const [url, options] = vi.mocked(apiClient).mock.calls[0];
    expect(url).toBe('/parameters/incidents.primaryAckTimeoutSeconds');
    expect(options?.method).toBe('PATCH');
    expect(JSON.parse(options?.body as string)).toEqual({
      value: 90,
      expectedVersion: 3,
      reason: 'Faster demo',
    });
  });
});
