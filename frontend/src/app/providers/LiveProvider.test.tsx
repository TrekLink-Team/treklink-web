// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSession } from '../../entities/session/model';
import type { LiveMessage } from '../../shared/socket/socketClient';
import { LiveProvider } from './LiveProvider';

const live = vi.hoisted(() => ({
  listener: undefined as undefined | ((message: LiveMessage) => void),
}));
vi.mock('../../shared/socket/socketClient', () => ({
  startLive: vi.fn(),
  stopLive: vi.fn(),
  refreshLiveAuth: vi.fn(),
  subscribeLive: (listener: (message: LiveMessage) => void) => {
    live.listener = listener;
    return () => {
      live.listener = undefined;
    };
  },
}));

beforeEach(() => {
  useSession.setState({
    user: {
      id: 'u-1',
      email: 'manager@example.invalid',
      fullName: 'Manager',
      roles: ['ORG_MANAGER'],
      accountType: 'ORGANIZATION',
      organization: {
        id: 'org-1',
        code: 'ORG-0001',
        legalName: 'Demo',
        status: 'ACTIVE',
        memberRole: 'MANAGER',
      },
    },
  });
});
afterEach(() => {
  cleanup();
  useSession.getState().signOut();
});

describe('LiveProvider contract views (screens 5.2 and 5.6)', () => {
  const mount = (read: () => Promise<string>) => {
    const Contract = () => {
      const query = useQuery({ queryKey: ['contract', 'c-1'], queryFn: read, staleTime: Infinity });
      return <span>{query.data}</span>;
    };
    return render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
      >
        <LiveProvider>
          <Contract />
        </LiveProvider>
      </QueryClientProvider>,
    );
  };

  it.each(['device.label', 'device.handedOver', 'device.released'])(
    'refreshes an open contract after %s from another session',
    async (type) => {
      const read = vi.fn().mockResolvedValueOnce('Before change').mockResolvedValue('After change');
      mount(read);
      await screen.findByText('Before change');
      act(() =>
        live.listener?.({
          kind: 'entry',
          entry: { seq: 1, type, payload: {}, createdAt: '2026-10-30T07:00:00Z' },
        }),
      );
      await screen.findByText('After change');
      expect(read).toHaveBeenCalledTimes(2);
    },
  );

  it('recovers a contract when replay expired, without refetching it for each position', async () => {
    const read = vi.fn().mockResolvedValueOnce('Before change').mockResolvedValue('After change');
    mount(read);
    await screen.findByText('Before change');
    await act(async () =>
      live.listener?.({
        kind: 'entry',
        entry: { seq: 1, type: 'device.position', payload: {}, createdAt: '2026-10-30T07:00:00Z' },
      }),
    );
    expect(read).toHaveBeenCalledTimes(1);
    act(() => live.listener?.({ kind: 'replay.expired' }));
    await screen.findByText('After change');
  });
});
