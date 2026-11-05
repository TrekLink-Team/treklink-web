import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchDevices, fetchMaintenanceRecords } from './api';

const api = vi.fn();
vi.mock('../../shared/api/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../shared/api/apiClient')>()),
  apiClient: (...args: unknown[]) => api(...args),
}));

afterEach(() => api.mockReset());

// W26: devices api-design 06 and 15 take `sort` and `order`; the default order sends neither.
describe('device list reads with a server sort', () => {
  it('sends sort and order on the fleet read', async () => {
    await fetchDevices({ status: ['AVAILABLE'], sort: 'lastSeenAt', order: 'desc' });
    expect(api).toHaveBeenLastCalledWith(
      '/devices?pageSize=20&pageNumber=1&status=AVAILABLE&sort=lastSeenAt&order=desc',
    );
    await fetchDevices({});
    expect(api).toHaveBeenLastCalledWith('/devices?pageSize=20&pageNumber=1');
  });

  it('sends sort and order on the maintenance record read', async () => {
    await fetchMaintenanceRecords({ pageNumber: 2, sort: 'assetTag', order: 'asc' });
    expect(api).toHaveBeenLastCalledWith('/maintenance-records?pageSize=20&pageNumber=2&sort=assetTag&order=asc');
    await fetchMaintenanceRecords({ order: 'desc' });
    expect(api).toHaveBeenLastCalledWith('/maintenance-records?pageSize=20&pageNumber=1');
  });
});
