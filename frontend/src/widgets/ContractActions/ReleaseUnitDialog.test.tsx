// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContractDetail, ContractDevice, ReleasePreview } from '../../entities/contract/api';
import { ApiError } from '../../shared/api/apiClient';
import { ReleaseUnitDialog } from './ReleaseUnitDialog';

// Release a unit (screen 5.2 "Release a unit", rentals api-design 33 and 34, D-099).
const api = vi.fn();
vi.mock('../../shared/api/apiClient', async (original) => ({
  ...(await original<typeof import('../../shared/api/apiClient')>()),
  apiClient: (...args: unknown[]) => api(...args),
}));

const contract = {
  id: 'c-2',
  code: 'RC-2026-0002',
  status: 'ACTIVE',
  version: 9,
} as unknown as ContractDetail;
const device = { deviceId: 'd-42', assetTag: 'TL-0042' } as unknown as ContractDevice;

const RUNNING: ReleasePreview = {
  phase: 'RUNNING',
  quantityBefore: 5,
  quantityAfter: 4,
  lastUnit: false,
  credit: { applies: true, unusedDays: 20, termDays: 30, computedVnd: 300_000 },
  firstInvoice: null,
};

const close = vi.fn();
const open = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ReleaseUnitDialog contract={contract} device={device} onClose={close} />
    </QueryClientProvider>,
  );

beforeEach(() => {
  api.mockReset();
  close.mockReset();
});
afterEach(cleanup);

describe('ReleaseUnitDialog (D-099)', () => {
  it('names the unit, the quantity and the credit from the preview, and keeps focus on Keep the unit', async () => {
    api.mockResolvedValue(RUNNING);
    open();
    expect(
      screen.getByRole('alertdialog', { name: 'Release TL-0042 from RC-2026-0002?' }),
    ).toBeTruthy();
    expect(await screen.findByText('5 to 4 units')).toBeTruthy();
    expect(screen.getByText(/A credit of 300,000 VND for 20 unused days of 30/)).toBeTruthy();
    expect(screen.getByText(/Bring the unit to the counter first/)).toBeTruthy();
    expect(document.activeElement?.textContent).toBe('Keep the unit');
  });

  it('needs a reason, then releases with the version it saw', async () => {
    api.mockImplementation((endpoint: string) =>
      endpoint.endsWith('/release-preview')
        ? Promise.resolve(RUNNING)
        : Promise.resolve({ contract: { quantity: 4, version: 10 } }),
    );
    open();
    await screen.findByText('5 to 4 units');
    fireEvent.click(screen.getByRole('button', { name: 'Release' }));
    expect(screen.getByText('Enter why the organization gives the unit back.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'The group shrank' } });
    fireEvent.click(screen.getByRole('button', { name: 'Release' }));
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(api).toHaveBeenCalledWith('/contracts/c-2/devices/d-42/release', {
      method: 'POST',
      body: JSON.stringify({ reason: 'The group shrank', expectedVersion: 9 }),
    });
  });

  it('shows the lowered first invoice before handover, and a refused preview keeps Release disabled', async () => {
    api.mockResolvedValueOnce({
      ...RUNNING,
      phase: 'BEFORE_HANDOVER',
      credit: null,
      firstInvoice: {
        totalVnd: 2_250_000,
        paidVnd: 2_250_000,
        newTotalVnd: 1_800_000,
        owedToOrganizationVnd: 450_000,
      },
    });
    open();
    expect(
      await screen.findByText(
        /The first invoice drops from 2,250,000 VND to 1,800,000 VND. 450,000 VND already paid is owed back/,
      ),
    ).toBeTruthy();
    cleanup();
    api.mockRejectedValueOnce(
      new ApiError(409, 'LAST_UNIT', 'This is the last unit. End the contract now instead.'),
    );
    open();
    expect(
      await screen.findByText('This is the last unit. End the contract now instead.'),
    ).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Release' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
