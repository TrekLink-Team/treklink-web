// @vitest-environment jsdom
import React, { type PropsWithChildren } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiError, apiClient } from '../../shared/api/apiClient';
import { quickResultOf, useRunDemoQuick } from './api';

vi.mock('../../shared/api/apiClient', async (original) => ({
  ...(await original<typeof import('../../shared/api/apiClient')>()),
  apiClient: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const setup = () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { ...renderHook(() => useRunDemoQuick(), { wrapper }), invalidate };
};
it('keeps partial scenario results and invalidates all affected domains', async () => {
  const response = {
    runId: 1,
    label: 'Demo 1',
    records: [{ label: 'Contract', code: 'RC-1', path: '/t/contracts/1' }],
    error: 'Provision the key first.',
    errorCode: 'DEVICE_NOT_PROVISIONED',
  };
  const failure = new ApiError(409, response.errorCode, response.error, response);
  vi.mocked(apiClient).mockRejectedValueOnce(failure);
  const hook = setup();
  await act(async () => {
    await expect(
      hook.result.current.mutateAsync({ action: 'contract', input: { target: 'ACTIVE' } }),
    ).rejects.toBe(failure);
    expect(quickResultOf(failure)).toEqual(response);
  });
  expect(apiClient).toHaveBeenCalledWith('/demo/quick/contract', {
    method: 'POST',
    body: JSON.stringify({ target: 'ACTIVE' }),
  });
  expect(hook.invalidate).toHaveBeenCalledWith();
});
it('refreshes after transport failure and exposes its cause to the caller', async () => {
  vi.mocked(apiClient).mockRejectedValueOnce(new Error('Connection unavailable'));
  const hook = setup();
  await act(async () => {
    await expect(
      hook.result.current.mutateAsync({ action: 'organization', input: {} }),
    ).rejects.toThrow('Connection unavailable');
  });
  expect(hook.invalidate).toHaveBeenCalledWith();
});

it('ignores unrelated or malformed error details', () => {
  expect(quickResultOf(new Error('offline'))).toBeNull();
  expect(quickResultOf(new ApiError(403, 'FORBIDDEN', 'Forbidden'))).toBeNull();
  expect(
    quickResultOf(
      new ApiError(409, 'STALE_VERSION', 'Reload', { runId: 1, label: 'Demo 1', records: [null] }),
    ),
  ).toBeNull();
});
