// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { LiveEntry } from '../../shared/socket/socketClient';
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

vi.mock('./api', () => ({
  useMapSnapshot: () => ({ data: undefined }),
}));

const entry = (type: string, deviceId?: string) =>
  ({
    seq: 5,
    type,
    deviceId,
    organizationId: 'org-1',
    payload: { incidentId: 'inc-1', state: 'NOTIFY_PRIMARY' },
    at: '2026-10-30T15:00:00Z',
  }) as unknown as LiveEntry;

describe('useLiveMap stream handling', () => {
  it('reloads the snapshot for an incident change that names no device, so a new SOS shows', () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    renderHook(() => useLiveMap(null), { wrapper });

    act(() => listener?.({ kind: 'entry', entry: entry('incident.changed') }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['map', 'snapshot'] });

    invalidate.mockClear();
    act(() => listener?.({ kind: 'entry', entry: entry('incident.changed', 'dev-10') }));
    act(() => listener?.({ kind: 'entry', entry: entry('device.position', 'dev-10') }));
    expect(invalidate).not.toHaveBeenCalled();
  });
});
