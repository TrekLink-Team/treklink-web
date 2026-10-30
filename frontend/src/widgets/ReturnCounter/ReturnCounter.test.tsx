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
const resetDevice = vi.fn();
const inspectDevice = vi.fn();
const ratesSeen: (string | undefined)[] = [];

// Generic rows of two codes, one replaced by the variant's own rate, one inactive, one of another
// variant (billing api-design 05 with `hardwareVariantId`).
const rate = (
  code: string,
  hardwareVariantId: string | null,
  amountVnd: number,
  isActive = true,
) => ({
  id: `${code}-${hardwareVariantId ?? 'generic'}`,
  code,
  label:
    code === 'ANTENNA_BROKEN'
      ? 'Antenna broken'
      : code === 'CASE_CRACKED'
        ? 'Case cracked'
        : 'Other',
  hardwareVariantId,
  amountVnd,
  isActive,
});
const RATES = [
  rate('ANTENNA_BROKEN', null, 150_000),
  rate('ANTENNA_BROKEN', 'v-3', 200_000),
  rate('CASE_CRACKED', null, 300_000),
  rate('SCREEN_BROKEN', null, 400_000, false),
  rate('STRAP_TORN', 'v-4', 50_000),
];

vi.mock('../../entities/contract/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../entities/contract/api')>()),
  checkInDevices: (...args: unknown[]) => checkInDevices(...args),
  closeContract: (...args: unknown[]) => closeContract(...args),
  resetDevice: (...args: unknown[]) => resetDevice(...args),
  inspectDevice: (...args: unknown[]) => inspectDevice(...args),
}));

vi.mock('../../entities/billing/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../entities/billing/api')>()),
  useBalance: () => ({ data: { dueNowVnd: 700_000, dueLaterVnd: 0, paidVnd: 0 } }),
  useDamageRates: (hardwareVariantId?: string) => {
    ratesSeen.push(hardwareVariantId);
    return { data: RATES, isLoading: false, error: null, refetch: vi.fn() };
  },
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
    hardwareVariant: { id: 'v-3', code: 'treklink-v3' },
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
  resetDevice.mockReset();
  inspectDevice.mockReset();
  ratesSeen.length = 0;
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
  it('offers the damage codes of the variant as checkboxes and sends the chosen ones (5.5)', async () => {
    resetDevice.mockResolvedValue(undefined);
    inspectDevice.mockResolvedValue({
      inspection: {
        id: 'i-1',
        result: 'DAMAGED',
        damageCodes: ['CASE_CRACKED'],
        createdAt: '2026-10-30T04:00:00Z',
      },
      device: { id: 'd-TL-0009', assetTag: 'TL-0009', status: 'MAINTENANCE' },
      damageCharge: { id: 'dc-1', amountVnd: 300_000, status: 'APPROVED' },
    });
    renderCounter(
      contract({
        devices: [device('TL-0009', { checkedInAt: '2026-10-30T03:00:00Z' })],
      } as Partial<ContractDetail>),
    );
    fireEvent.click(screen.getByRole('tab', { name: /Reset and inspection/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Record reset' }));
    ['Channel key removed', 'Node database cleared', 'Owner name cleared'].forEach((step) =>
      fireEvent.click(screen.getByLabelText(step)),
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Record reset' }).at(-1)!);
    fireEvent.click(await screen.findByRole('button', { name: 'Inspect' }));
    fireEvent.click(screen.getByLabelText('Damaged'));

    expect(ratesSeen).toContain('v-3');
    // One box per active code of this variant or generic; the variant's own amount wins.
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(screen.getByText('200,000 VND')).toBeTruthy();
    expect(screen.queryByText(/SCREEN_BROKEN|STRAP_TORN/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Record inspection' }));
    expect(screen.getByText('Choose at least one damage code.')).toBeTruthy();
    expect(inspectDevice).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText(/Case cracked \(CASE_CRACKED\)/));
    fireEvent.click(screen.getByRole('button', { name: 'Record inspection' }));
    await waitFor(() =>
      expect(inspectDevice).toHaveBeenCalledWith('c-1', 'd-TL-0009', {
        result: 'DAMAGED',
        damageCodes: ['CASE_CRACKED'],
        note: undefined,
      }),
    );
  });
});
