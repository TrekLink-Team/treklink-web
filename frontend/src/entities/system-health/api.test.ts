import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../shared/api/apiClient';
import { fetchSystemHealth, HEALTH_WINDOWS, healthKeys } from './api';

vi.mock('../../shared/api/apiClient', () => ({ apiClient: vi.fn() }));

describe('the system health read (monitoring api-design 06)', () => {
  beforeEach(() => vi.mocked(apiClient).mockReset());

  it('sends the window in minutes', async () => {
    await fetchSystemHealth(240);
    expect(vi.mocked(apiClient).mock.calls[0][0]).toBe('/system-health?windowMinutes=240');
  });

  it('keys a query by its window under the prefix the live event invalidates', () => {
    expect(healthKeys.window(15)).toEqual(['system-health', 15]);
    expect(healthKeys.all).toEqual(['system-health']);
    expect(HEALTH_WINDOWS).toEqual([15, 60, 240]);
  });
});
