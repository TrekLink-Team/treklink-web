// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useMapSnapshot, type MapSnapshot } from './api';

const apiClient = vi.fn();
vi.mock('../../shared/api/apiClient', () => ({
  apiClient: (...args: unknown[]) => apiClient(...args),
}));

const snapshot = (state: 'RESPONDING' | 'RESOLVED'): MapSnapshot => ({
  cursor: state === 'RESPONDING' ? 10 : 20,
  fieldStations: [],
  devices: [
    {
      id: 'dev-10',
      assetTag: 'TL-0010',
      hardwareVariant: 'treklink-v3',
      holder: { name: 'Pham Van F' },
      position: null,
      batteryPct: null,
      lastSeenAt: null,
      stale: false,
      state: 'NOT_HEARD',
      handedOverAt: '2026-10-29T00:00:00.000Z',
      counterLocation: { name: 'TrekLink counter', lat: 11.9, lon: 108.4 },
      openIncident: { id: 'inc-2', code: 'INC-2026-000002', state },
      contractCode: 'RC-2026-0001',
      organizationId: 'org-1',
    },
  ],
});

describe('useMapSnapshot', () => {
  // Smoke 3 (2026-10-31): the stream entries are kept only while the map is mounted, so an incident
  // resolved on its own page still read "1 SOS open" when the Operator came back to the map.
  it('reads the snapshot again when the map mounts again', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    apiClient.mockResolvedValueOnce(snapshot('RESPONDING'));
    const first = renderHook(() => useMapSnapshot(null), { wrapper });
    await waitFor(() => expect(first.result.current.data?.cursor).toBe(10));
    first.unmount();

    apiClient.mockResolvedValueOnce(snapshot('RESOLVED'));
    const second = renderHook(() => useMapSnapshot(null), { wrapper });
    await waitFor(() =>
      expect(second.result.current.data?.devices[0].openIncident?.state).toBe('RESOLVED'),
    );
    expect(apiClient).toHaveBeenCalledTimes(2);
  });
});
