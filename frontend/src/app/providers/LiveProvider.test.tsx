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
  const mount = (read: () => Promise<string>, queryKey: unknown[] = ['contract', 'c-1']) => {
    const Contract = () => {
      const query = useQuery({ queryKey, queryFn: read, staleTime: Infinity });
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

  // Two open contract details: c-1 holds device d-1, c-2 holds device d-2.
  const mountTwo = () => {
    const reads = { 'c-1': 0, 'c-2': 0 };
    const Contract = ({ id, deviceId }: { id: 'c-1' | 'c-2'; deviceId: string }) => {
      const query = useQuery({
        queryKey: ['contract', id],
        queryFn: () => {
          reads[id] += 1;
          return Promise.resolve({ id, read: reads[id], devices: [{ deviceId }] });
        },
        staleTime: Infinity,
      });
      return <span>{query.data ? `${id} read ${query.data.read}` : ''}</span>;
    };
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
      >
        <LiveProvider>
          <Contract id="c-1" deviceId="d-1" />
          <Contract id="c-2" deviceId="d-2" />
        </LiveProvider>
      </QueryClientProvider>,
    );
    return reads;
  };
  const push = (type: string, deviceId: string, payload: Record<string, unknown> = {}) =>
    act(() =>
      live.listener?.({
        kind: 'entry',
        entry: { seq: 1, type, deviceId, payload, createdAt: '2026-10-30T07:00:00Z' },
      }),
    );

  it.each(['device.label', 'device.released'])(
    'refreshes only the open contract holding the device after %s from another session',
    async (type) => {
      const reads = mountTwo();
      await screen.findByText('c-1 read 1');
      await screen.findByText('c-2 read 1');
      push(type, 'd-1');
      await screen.findByText('c-1 read 2');
      expect(reads['c-2']).toBe(1);
    },
  );

  it('refreshes the contract named by device.handedOver even when it does not hold the device yet (rentals 4.3)', async () => {
    const reads = mountTwo();
    await screen.findByText('c-1 read 1');
    await screen.findByText('c-2 read 1');
    // A replacement unit d-9 is handed over on c-1; neither cached detail lists it.
    push('device.handedOver', 'd-9', { contractId: 'c-1', at: '2026-10-30T07:00:00Z' });
    await screen.findByText('c-1 read 2');
    expect(reads['c-2']).toBe(1);
  });

  it('refreshes an open contract after device.handedOver with no contract id', async () => {
    const read = vi.fn().mockResolvedValueOnce('Before change').mockResolvedValue('After change');
    mount(read);
    await screen.findByText('Before change');
    push('device.handedOver', 'd-1');
    await screen.findByText('After change');
    expect(read).toHaveBeenCalledTimes(2);
  });

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

  // Screen 5.6: the amount due follows a check-in, whose late fee lands on an invoice.
  const invoices = ['invoices', 'o', { pageSize: 100 }];
  const entry = (type: string) =>
    live.listener?.({
      kind: 'entry',
      entry: { seq: 1, type, payload: {}, createdAt: '2026-10-30T07:00:00Z' },
    });

  it('refreshes the invoice lists after device.released, and after an expired replay', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce('Before change')
      .mockResolvedValueOnce('After release')
      .mockResolvedValue('After replay');
    mount(read, invoices);
    await screen.findByText('Before change');
    act(() => entry('device.released'));
    await screen.findByText('After release');
    act(() => live.listener?.({ kind: 'replay.expired' }));
    await screen.findByText('After replay');
  });

  it('refreshes the invoice lists once for a burst of releases, as a bulk check-in sends', async () => {
    const read = vi.fn().mockResolvedValueOnce('Before change').mockResolvedValue('After release');
    mount(read, invoices);
    await screen.findByText('Before change');
    act(() => {
      entry('device.released');
      entry('device.released');
      entry('device.released');
    });
    await screen.findByText('After release');
    await act(() => new Promise((resolve) => setTimeout(resolve, 250)));
    expect(read).toHaveBeenCalledTimes(2);
  });

  // Two open invoices, each with its contract detail cached: i-1 of c-1 (device d-1), i-2 of c-2 (d-2).
  const mountInvoices = (withContracts = true) => {
    const reads: Record<string, number> = { 'i-1': 0, 'i-2': 0 };
    const Invoice = ({ id, contractId }: { id: string; contractId: string }) => {
      const query = useQuery({
        queryKey: ['invoice', id],
        queryFn: () => {
          reads[id] += 1;
          return Promise.resolve({ id, read: reads[id], contract: { id: contractId } });
        },
        staleTime: Infinity,
      });
      return <span>{query.data ? `${id} read ${query.data.read}` : ''}</span>;
    };
    const Contract = ({ id, deviceId }: { id: string; deviceId: string }) => {
      useQuery({
        queryKey: ['contract', id],
        queryFn: () => Promise.resolve({ id, devices: [{ deviceId }] }),
        staleTime: Infinity,
      });
      return null;
    };
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
      >
        <LiveProvider>
          {withContracts && <Contract id="c-1" deviceId="d-1" />}
          {withContracts && <Contract id="c-2" deviceId="d-2" />}
          <Invoice id="i-1" contractId="c-1" />
          <Invoice id="i-2" contractId="c-2" />
        </LiveProvider>
      </QueryClientProvider>,
    );
    return reads;
  };

  it('refreshes only the invoice of the contract holding a released device', async () => {
    const reads = mountInvoices();
    await screen.findByText('i-1 read 1');
    await screen.findByText('i-2 read 1');
    push('device.released', 'd-1');
    await screen.findByText('i-1 read 2');
    await act(() => new Promise((resolve) => setTimeout(resolve, 250)));
    expect(reads['i-2']).toBe(1);
  });

  it('refreshes only the invoice of the contract the release names, with no contract cached', async () => {
    const reads = mountInvoices(false);
    await screen.findByText('i-1 read 1');
    await screen.findByText('i-2 read 1');
    push('device.released', 'd-9', { contractId: 'c-2', checkedInAt: '2026-10-30T07:00:00Z' });
    await screen.findByText('i-2 read 2');
    await act(() => new Promise((resolve) => setTimeout(resolve, 250)));
    expect(reads['i-1']).toBe(1);
  });

  it('refreshes every open invoice when a release without a contract id names an uncached device', async () => {
    const reads = mountInvoices(false);
    await screen.findByText('i-1 read 1');
    await screen.findByText('i-2 read 1');
    push('device.released', 'd-1');
    await screen.findByText('i-1 read 2');
    await screen.findByText('i-2 read 2');
    expect(reads).toEqual({ 'i-1': 2, 'i-2': 2 });
  });

  it('leaves the invoice lists alone for a label or a handover', async () => {
    const read = vi.fn().mockResolvedValue('Invoices');
    mount(read, invoices);
    await screen.findByText('Invoices');
    await act(async () => {
      entry('device.label');
      entry('device.handedOver');
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    expect(read).toHaveBeenCalledTimes(1);
  });
});
