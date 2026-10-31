// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { LiveEntry } from '../../shared/socket/socketClient';
import type { MapSnapshot } from './api';
import { useLiveMap } from './useLiveMap';

type Listener = (
  message: { kind: 'entry'; entry: LiveEntry } | { kind: 'paused'; paused: boolean },
) => void;
let listener: Listener | null = null;

vi.mock('../../shared/socket/socketClient', () => ({
  isLivePaused: () => false,
  subscribeLive: (fn: Listener) => {
    listener = fn;
    return () => undefined;
  },
}));

// The snapshot the hook reads; `dev-10` already holds `inc-1` once it has answered.
let snapshotData: MapSnapshot | undefined;
vi.mock('./api', () => ({
  useMapSnapshot: () => ({ data: snapshotData }),
}));

const answered: MapSnapshot = {
  cursor: 1,
  fieldStations: [],
  devices: [
    {
      id: 'dev-10',
      assetTag: 'TL-0010',
      hardwareVariant: 'treklink-v3',
      holder: null,
      position: null,
      batteryPct: null,
      lastSeenAt: null,
      stale: false,
      openIncident: { id: 'inc-1', code: 'INC-2026-000001', state: 'NOTIFY_PRIMARY' },
      contractCode: 'RC-2026-0001',
      organizationId: 'org-1',
    },
  ],
};

const entry = (type: string, deviceId?: string, incidentId = 'inc-1') =>
  ({
    seq: 5,
    type,
    deviceId,
    organizationId: 'org-1',
    payload: { incidentId, state: 'NOTIFY_PRIMARY' },
    at: '2026-10-30T15:00:00Z',
  }) as unknown as LiveEntry;

describe('useLiveMap stream handling', () => {
  const render = () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    renderHook(() => useLiveMap(null), { wrapper });
    return invalidate;
  };

  it('reloads the snapshot for an incident change that names no device, not for a held one', () => {
    snapshotData = answered;
    const invalidate = render();

    act(() => listener?.({ kind: 'entry', entry: entry('incident.changed') }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['map', 'snapshot'] });

    invalidate.mockClear();
    act(() => listener?.({ kind: 'entry', entry: entry('incident.changed', 'dev-10') }));
    act(() => listener?.({ kind: 'entry', entry: entry('device.position', 'dev-10') }));
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('reloads the snapshot for a new incident on a named marker, so its code shows', () => {
    snapshotData = answered;
    const invalidate = render();

    act(() => listener?.({ kind: 'entry', entry: entry('incident.changed', 'dev-10', 'inc-2') }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['map', 'snapshot'] });
  });
});
