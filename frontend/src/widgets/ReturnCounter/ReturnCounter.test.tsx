// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContractDetail } from '../../entities/contract/api';
import { ApiError } from '../../shared/api/apiClient';
import { ReturnCounter } from './ReturnCounter';

const checkInDevices = vi.fn();
const closeContract = vi.fn();

vi.mock('../../entities/contract/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../entities/contract/api')>()),
  checkInDevices: (...args: unknown[]) => checkInDevices(...args),
  closeContract: (...args: unknown[]) => closeContract(...args),
}));

vi.mock('../../entities/billing/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../entities/billing/api')>()),
  useBalance: () => ({ data: { dueNowVnd: 700_000, dueLaterVnd: 0, paidVnd: 0 } }),
}));

const device = (tag: string, overrides: object = {}) => ({
  deviceId: `d-${tag}`,
  assetTag: tag,
  handedOverAt: '2026-10-01T03:00:00Z',
  checkedInAt: null,
  lostAt: null,
  holder: null,
  ...overrides,
});

const contract = (overrides: Partial<ContractDetail> = {}) =>
  ({
    id: 'c-1',
    code: 'RC-2026-0001',
    planType: 'MONTHLY',
    status: 'RETURN_DUE',
    version: 6,
    devices: [device('TL-0009'), device('TL-0010')],
    ...overrides,
  }) as ContractDetail;

const renderCounter = (value: ContractDetail) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ReturnCounter contract={value} />
      </MemoryRouter>
    </QueryClientProvider>,
  );

afterEach(() => {
  cleanup();
  checkInDevices.mockReset();
  closeContract.mockReset();
});

describe('ReturnCounter (screen 5.5)', () => {
  it('collects scanned tags, refuses one of another contract and shows MSG07 after check-in', async () => {
    checkInDevices.mockResolvedValue({
      checkedIn: ['TL-0009'],
      returned: 1,
      total: 2,
      contractStatus: 'RETURN_DUE',
      lateFeeVnd: 200_000,
    });
    renderCounter(contract());
    const scan = screen.getByLabelText(/Scan or type an asset tag/);
    fireEvent.change(scan, { target: { value: 'tl-0099' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByText('TL-0099 does not belong to contract RC-2026-0001.')).toBeTruthy();
    fireEvent.change(scan, { target: { value: 'tl-0009' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.click(screen.getByRole('button', { name: /Check in 1 devices/ }));
    await waitFor(() =>
      expect(screen.getByText(/Check-in complete. 1 of 2 devices returned./)).toBeTruthy(),
    );
    expect(checkInDevices).toHaveBeenCalledWith('c-1', ['TL-0009']);
    expect(screen.getByText(/Late fee: 200,000/)).toBeTruthy();
  });

  it('keeps check-in closed on a running monthly contract (REQ-STA-01)', () => {
    renderCounter(contract({ status: 'ACTIVE' }));
    expect(
      screen.getByText('A running monthly contract cannot return devices. Give notice first.'),
    ).toBeTruthy();
  });

  it('asks before closing and shows MSG29 when balances are open', async () => {
    closeContract.mockRejectedValue(
      new ApiError(409, 'BALANCE_OUTSTANDING', 'This cannot be done while it has open balances.'),
    );
    renderCounter(contract({ status: 'RETURNED' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close contract' }));
    expect(screen.getByText('Close contract RC-2026-0001?')).toBeTruthy();
    const confirm = screen.getAllByRole('button', { name: 'Close contract' }).at(-1)!;
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(
        screen.getAllByText(/open balances. Settle the invoices first./).length,
      ).toBeGreaterThan(0),
    );
    expect(closeContract).toHaveBeenCalledWith('c-1', 6);
  });
});
