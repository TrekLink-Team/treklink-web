import { describe, expect, it, vi } from 'vitest';
import { fetchHandoverPreview, nextDateOf, type Contract } from './api';

const apiClient = vi.fn();

vi.mock('../../shared/api/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../shared/api/apiClient')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));

const contract = (status: Contract['status']): Contract =>
  ({ status, requestedStartDate: '2026-10-28', currentTerm: null, returnDueAt: null }) as Contract;

describe('nextDateOf (screen 5.2)', () => {
  it('uses the requested start date of a request', () => {
    expect(nextDateOf(contract('REQUESTED'))).toEqual({ day: '2026-10-28' });
  });

  it.each(['REJECTED', 'CANCELLED', 'RETURNED', 'CLOSED'] as const)(
    'has no next date once the contract is %s',
    (status) => {
      expect(nextDateOf(contract(status))).toBeNull();
    },
  );
});

describe('fetchHandoverPreview (rentals api-design 08)', () => {
  it('sends the counter readings as the checks query, and none without readings', async () => {
    apiClient.mockResolvedValue({ pdfBase64: null, sha256: null });
    const checks = [{ deviceId: 'd-1', batteryPct: 96, gpsFixOk: true }];
    await fetchHandoverPreview('c-1', checks);
    await fetchHandoverPreview('c-1');
    const [withChecks, without] = apiClient.mock.calls.map((call) => String(call[0]));
    const url = new URL(withChecks, 'http://localhost');
    expect(url.pathname).toBe('/contracts/c-1/handover-note/preview');
    expect(JSON.parse(url.searchParams.get('checks') ?? '')).toEqual(checks);
    expect(without).toBe('/contracts/c-1/handover-note/preview');
  });
});
