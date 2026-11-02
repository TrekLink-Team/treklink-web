// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lineStatus, usePlans } from './api';

const apiClient = vi.fn();
vi.mock('../../shared/api/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../shared/api/apiClient')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));

const renderPlans = (options?: Parameters<typeof usePlans>[0]) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: React.PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => usePlans(options), { wrapper });
  return { client, hook };
};

const optionsOf = (client: QueryClient) =>
  client.getQueryCache().find({ queryKey: ['plans'] })?.observers[0]?.options;

afterEach(() => {
  cleanup();
  apiClient.mockReset();
  focusManager.setFocused(undefined);
});

// The real option merge of usePlans, which PlansPage.test.tsx mocks (review of #128).
describe('usePlans (billing api-design 01)', () => {
  it('reads /plans, fresh for a minute by default', async () => {
    apiClient.mockResolvedValue({ variants: [] });
    const { client, hook } = renderPlans();
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    expect(apiClient).toHaveBeenCalledWith('/plans');
    expect(optionsOf(client)?.staleTime).toBe(60_000);
  });

  it('lets the caller override the freshness and keeps a window focus from refetching', async () => {
    apiClient.mockResolvedValue({ variants: [] });
    const { client, hook } = renderPlans({ staleTime: 0, refetchOnWindowFocus: false });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    expect(optionsOf(client)).toMatchObject({ staleTime: 0, refetchOnWindowFocus: false });
    expect(optionsOf(client)?.queryKey).toEqual(['plans']);
    // Stale at once, so only refetchOnWindowFocus: false keeps the focus from reading again.
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(apiClient).toHaveBeenCalledTimes(1);
  });
});

describe('lineStatus (screen 6.1)', () => {
  const line = {
    seq: 3,
    type: 'SERVICE_CREDIT',
    description: 'Service credit',
    quantity: 1,
    unitVnd: -45_000,
    dueAt: '2026-12-02T03:00:00Z',
  };

  it('reads a negative line as a credit, never as paid or owed (billing design §9.3)', () => {
    expect(
      lineStatus({ ...line, amountVnd: -45_000, paidVnd: 0 }, new Date('2026-12-10T00:00:00Z')),
    ).toBe('Credit');
    expect(lineStatus({ ...line, type: 'TERM_BALANCE', amountVnd: 45_000, paidVnd: 45_000 })).toBe(
      'Paid',
    );
  });
});
