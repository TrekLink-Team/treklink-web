// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../shared/api/apiClient';
import { ReportLossDialog } from './ReportLossDialog';

const api = vi.fn();
vi.mock('../../shared/api/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../shared/api/apiClient')>()),
  apiClient: (...args: unknown[]) => api(...args),
}));

const renderDialog = (scope: 'o' | 't', onReported = vi.fn()) => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ReportLossDialog deviceId="dev-1" assetTag="TL-0042" scope={scope} onReported={onReported} onClose={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return onReported;
};

beforeEach(() => {
  api.mockReset();
});
afterEach(cleanup);

describe('ReportLossDialog (devices api-design 17, screen 4.4)', () => {
  it('requires a description, then reports and shows the Manager the confirmation panel', async () => {
    api.mockResolvedValue({ id: 'lc-1', code: 'LOSS-0003' });
    const onReported = renderDialog('o');
    expect(screen.getByText('TrekLink will contact you. Late and loss charges follow the contract.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Report lost' }));
    expect(await screen.findByText('Description is required.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Description/), { target: { value: ' Lost on the ridge ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Report lost' }));
    expect(await screen.findByText('Loss reported. TrekLink will contact you.')).toBeTruthy();
    expect(api).toHaveBeenCalledWith('/devices/dev-1/loss-cases', {
      method: 'POST',
      body: JSON.stringify({ description: 'Lost on the ridge' }),
    });
    expect(onReported).toHaveBeenCalledWith({ id: 'lc-1', code: 'LOSS-0003' });
  });

  it('names an open case with a link to the loss cases (LOSS_CASE_OPEN)', async () => {
    const refusal = new ApiError(409, 'LOSS_CASE_OPEN', 'This device is already reported lost.');
    api.mockImplementation(() => Promise.reject(refusal));
    renderDialog('t');
    fireEvent.change(screen.getByLabelText(/Description/), { target: { value: 'Missing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Report lost' }));
    expect(await screen.findByText(/This device is already reported lost./)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open the loss cases' }).getAttribute('href')).toBe('/t/loss-cases');
  });
});
