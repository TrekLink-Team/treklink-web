// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { contractKeys, type CloseCheck, type ContractDetail } from '../../entities/contract/api';
import { ApiError } from '../../shared/api/apiClient';
import { useToast } from '../../shared/ui';
import { ReturnCounter } from './ReturnCounter';

const checkInDevices = vi.fn();
const closeContract = vi.fn();
const resetDevice = vi.fn();
const inspectDevice = vi.fn();
const ratesSeen: (string | undefined)[] = [];
const refetchRates = vi.fn();
const reportLoss = vi.fn();
// What rentals api-design 20 answers now; a test sets it.
let closeCheck: CloseCheck | undefined;

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
// What billing api-design 05 answers now; a test may change it to stand for a reload.
let offeredRates = RATES;

vi.mock('../../entities/contract/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../entities/contract/api')>()),
  checkInDevices: (...args: unknown[]) => checkInDevices(...args),
  closeContract: (...args: unknown[]) => closeContract(...args),
  resetDevice: (...args: unknown[]) => resetDevice(...args),
  inspectDevice: (...args: unknown[]) => inspectDevice(...args),
  useCloseCheck: () => ({
    data: closeCheck,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('../../entities/loss-case/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../entities/loss-case/api')>()),
  reportLoss: (...args: unknown[]) => reportLoss(...args),
}));

vi.mock('../../entities/billing/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../entities/billing/api')>()),
  useBalance: () => ({ data: { dueNowVnd: 700_000, dueLaterVnd: 0, paidVnd: 0 } }),
  useDamageRates: (hardwareVariantId?: string) => {
    ratesSeen.push(hardwareVariantId);
    return { data: offeredRates, isLoading: false, error: null, refetch: refetchRates };
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

const renderCounter = (value: ContractDetail, client = new QueryClient()) =>
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ReturnCounter contract={value} />
      </MemoryRouter>
    </QueryClientProvider>,
  );

afterEach(() => {
  cleanup();
  useToast.getState().dismiss();
  checkInDevices.mockReset();
  closeContract.mockReset();
  resetDevice.mockReset();
  inspectDevice.mockReset();
  ratesSeen.length = 0;
  offeredRates = RATES;
  refetchRates.mockReset();
  reportLoss.mockReset();
  closeCheck = undefined;
});

const check = (overrides: Partial<CloseCheck> = {}): CloseCheck => ({
  contractId: 'c-1',
  status: 'RETURN_DUE',
  version: 6,
  canClose: false,
  blockers: [],
  ...overrides,
});

// Checks in TL-0009, records its reset and opens Inspect with Damaged chosen.
const openDamagedInspection = async () => {
  resetDevice.mockResolvedValue(undefined);
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
};

describe('ReturnCounter (screen 5.5)', () => {
  it('keeps a logged reset after a reload: the read carries resetAt, so Staff go on to Inspect', () => {
    renderCounter(
      contract({
        devices: [
          device('TL-0017', {
            checkedInAt: '2026-10-30T03:00:00Z',
            resetAt: '2026-10-30T03:05:00Z',
            inspection: null,
          }),
          device('TL-0018', { checkedInAt: '2026-10-30T03:00:00Z', resetAt: null }),
        ],
      } as Partial<ContractDetail>),
    );
    fireEvent.click(screen.getByRole('tab', { name: /Reset and inspection/ }));

    expect(screen.getByText(/^Reset logged /)).toBeTruthy();
    expect(screen.getByText('Not reset')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Inspect' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Record reset' })).toHaveLength(1);
  });

  it('shows the recorded inspection of a unit after a reload and offers no action on it', () => {
    renderCounter(
      contract({
        devices: [
          device('TL-0017', {
            checkedInAt: '2026-10-30T03:00:00Z',
            resetAt: '2026-10-30T03:05:00Z',
            inspection: { result: 'FAILED', at: '2026-10-30T03:06:00Z' },
          }),
        ],
      } as Partial<ContractDetail>),
    );
    fireEvent.click(screen.getByRole('tab', { name: /Reset and inspection/ }));

    expect(screen.getByText('Failed, maintenance')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Inspect' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Record reset' })).toBeNull();
  });

  it('treats 409 ALREADY_RESET as a logged reset and moves the unit on to Inspect', async () => {
    resetDevice.mockRejectedValue(
      new ApiError(409, 'ALREADY_RESET', 'This device is already reset for this return.'),
    );
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    renderCounter(
      contract({
        devices: [device('TL-0009', { checkedInAt: '2026-10-30T03:00:00Z' })],
      } as Partial<ContractDetail>),
      client,
    );
    fireEvent.click(screen.getByRole('tab', { name: /Reset and inspection/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Record reset' }));
    ['Channel key removed', 'Node database cleared', 'Owner name cleared'].forEach((step) =>
      fireEvent.click(screen.getByLabelText(step)),
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Record reset' }).at(-1)!);

    expect(await screen.findByRole('button', { name: 'Inspect' })).toBeTruthy();
    expect(screen.queryByText('This device is already reset for this return.')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useToast.getState().message).toBe('Already reset. It was recorded by someone else.');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: contractKeys.detail('c-1') });
  });

  it('says Saved. after a reset this counter recorded', async () => {
    resetDevice.mockResolvedValue(undefined);
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
    expect(await screen.findByRole('button', { name: 'Inspect' })).toBeTruthy();
    expect(useToast.getState().message).toBe('Saved.');
  });

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
    closeCheck = check({ status: 'RETURNED', version: 7, canClose: true });
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
    // The version is the one the close check read.
    expect(closeContract).toHaveBeenCalledWith('c-1', 7);
  });

  // D-092 rule 3: the demo's contract of 5 units with 4 back, 1 damaged and 1 missing.
  it('lists every blocker with its link and offers no Close action while one is left', () => {
    closeCheck = check({
      blockers: [
        {
          code: 'NOT_RETURNED',
          message: 'The contract becomes Returned once every unit is checked in or settled lost.',
          waitsFor: '2026-11-01T01:59:00Z',
        },
        {
          code: 'DEVICE_OUT',
          message: 'TL-0010 is not back. Check it in, or report it lost.',
          deviceId: 'd-TL-0010',
          assetTag: 'TL-0010',
          lossCase: null,
        },
        {
          code: 'BALANCE_OUTSTANDING',
          message: "1,525,000 VND is unpaid on the contract's invoices.",
          amountVnd: 1_525_000,
        },
        {
          code: 'DAMAGE_PENDING',
          message: 'The damage charge of 1,200,000 VND on TL-0009 waits for an Admin.',
          chargeId: 'dc-1',
          deviceId: 'd-TL-0009',
          assetTag: 'TL-0009',
          amountVnd: 1_200_000,
        },
        {
          code: 'OPEN_INCIDENTS',
          message: 'This cannot be done while it has open incidents.',
          incidents: [{ id: 'inc-1', code: 'INC-2026-000002' }],
        },
      ],
    });
    renderCounter(contract());
    fireEvent.click(screen.getByRole('tab', { name: 'Close' }));

    expect(screen.getByText('What still blocks the close')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Report TL-0010 lost' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open the invoices' }).getAttribute('href')).toBe(
      '/t/billing?contractId=c-1',
    );
    expect(screen.getByRole('link', { name: 'Open damage charges' }).getAttribute('href')).toBe(
      '/t/damage-charges',
    );
    expect(screen.getByText('INC-2026-000002')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Close contract' })).toBeNull();
    // No replacement unit is asked for anywhere on a due contract.
    expect(screen.queryByRole('tab', { name: 'Replace a device' })).toBeNull();
  });

  it('shows Close once the close check passes, even when the cached contract still reads Return due', () => {
    // The loss was settled and the invoice paid in another window: the close check is refetched on
    // focus, the contract read is not (the missing close button of the 2026-11-01 demo).
    closeCheck = check({ status: 'RETURNED', canClose: true, version: 9 });
    renderCounter(contract({ status: 'RETURN_DUE' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Close' }));
    expect(screen.getByText('Nothing blocks the close. Close the contract below.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close contract' })).toBeTruthy();
  });

  it('reports a missing unit lost from the check-in tab and links an open loss case instead', async () => {
    reportLoss.mockResolvedValue({ id: 'lc-1', code: 'LOSS-0001', state: 'REPORTED' });
    closeCheck = check({
      blockers: [
        {
          code: 'DEVICE_OUT',
          message: 'TL-0009 is not back; its loss case LOSS-0002 is not settled yet.',
          deviceId: 'd-TL-0009',
          assetTag: 'TL-0009',
          lossCase: { id: 'lc-2', code: 'LOSS-0002', state: 'SEARCHING' },
        },
      ],
    });
    renderCounter(contract());

    expect(screen.getByText(/A unit that did not come back needs no replacement/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Loss case LOSS-0002 open' }).getAttribute('href')).toBe(
      '/t/loss-cases/lc-2',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Report lost' }));
    fireEvent.change(screen.getByLabelText(/Description/), {
      target: { value: 'Not handed back at the counter' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Report lost' }).at(-1)!);

    await waitFor(() =>
      expect(reportLoss).toHaveBeenCalledWith('d-TL-0010', 'Not handed back at the counter'),
    );
    await waitFor(() =>
      expect(useToast.getState().message).toBe('Loss case LOSS-0001 opened for TL-0010.'),
    );
  });

  it('shows the state after the return and links the next step kept outside the counter (D-092 rule 4)', () => {
    renderCounter(
      contract({
        devices: [
          device('TL-0009', {
            checkedInAt: '2026-10-30T03:00:00Z',
            resetAt: '2026-10-30T03:05:00Z',
            inspection: { result: 'DAMAGED', at: '2026-10-30T03:10:00Z' },
            afterReturn: {
              status: 'MAINTENANCE',
              nextStep: { action: 'COMPLETE_MAINTENANCE', contractId: null },
            },
          }),
          device('TL-0010', {
            checkedInAt: '2026-10-30T03:00:00Z',
            resetAt: '2026-10-30T03:05:00Z',
            inspection: { result: 'DAMAGED', at: '2026-10-30T03:10:00Z' },
            afterReturn: { status: 'MAINTENANCE', nextStep: { action: 'INTAKE', contractId: null } },
          }),
        ],
      } as Partial<ContractDetail>),
    );
    fireEvent.click(screen.getByRole('tab', { name: /Reset and inspection/ }));

    expect(screen.getByText(/Next: Complete maintenance/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open maintenance' }).getAttribute('href')).toBe(
      '/t/maintenance',
    );
    expect(screen.getByText(/Next: Intake check/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open TL-0010' }).getAttribute('href')).toBe(
      '/t/devices/d-TL-0010',
    );
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
  it('drops a code deactivated since the list loaded and sends only the codes still offered (review of #129)', async () => {
    await openDamagedInspection();
    fireEvent.click(screen.getByLabelText(/Antenna broken \(ANTENNA_BROKEN\)/));
    fireEvent.click(screen.getByLabelText(/Case cracked \(CASE_CRACKED\)/));
    inspectDevice.mockRejectedValueOnce(
      new ApiError(400, 'UNKNOWN_DAMAGE_CODE', 'Unknown damage code: CASE_CRACKED.'),
    );
    // The reload no longer offers CASE_CRACKED.
    refetchRates.mockImplementation(() => {
      offeredRates = RATES.filter((row) => row.code !== 'CASE_CRACKED');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Record inspection' }));
    expect(await screen.findByText('Unknown damage code: CASE_CRACKED.')).toBeTruthy();
    expect(refetchRates).toHaveBeenCalled();
    expect(screen.queryByLabelText(/Case cracked/)).toBeNull();

    inspectDevice.mockResolvedValueOnce({
      inspection: {
        id: 'i-1',
        result: 'DAMAGED',
        damageCodes: ['ANTENNA_BROKEN'],
        createdAt: '2026-10-30T04:00:00Z',
      },
      device: { id: 'd-TL-0009', assetTag: 'TL-0009', status: 'MAINTENANCE' },
      damageCharge: { id: 'dc-1', amountVnd: 200_000, status: 'APPROVED' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Record inspection' }));
    await waitFor(() =>
      expect(inspectDevice).toHaveBeenLastCalledWith('c-1', 'd-TL-0009', {
        result: 'DAMAGED',
        damageCodes: ['ANTENNA_BROKEN'],
        note: undefined,
      }),
    );
  });
});
