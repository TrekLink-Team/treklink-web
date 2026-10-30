// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../shared/api/apiClient';
import { CounterPage } from './CounterPage';

const recordProvisioning = vi.fn();
const completeHandover = vi.fn();
const fetchHandoverPreview = vi.fn();
const refetchInvoice = vi.fn(() => Promise.resolve());

const contract = {
  id: 'c-1',
  code: 'RC-2026-0002',
  organization: { id: 'org-1', code: 'ORG-0001', legalName: 'Acme Trek' },
  planType: 'MONTHLY',
  dayPlanDays: null,
  hardwareVariant: { id: 'v-3', code: 'treklink-v3' },
  quantity: 2,
  requestedStartDate: '2026-01-01',
  status: 'APPROVED',
  version: 3,
  devices: [
    {
      deviceId: 'd-1',
      assetTag: 'TL-0003',
      handedOverAt: null,
      checkedInAt: null,
      lostAt: null,
      holder: null,
    },
    {
      deviceId: 'd-2',
      assetTag: 'TL-0004',
      handedOverAt: null,
      checkedInAt: null,
      lostAt: null,
      holder: null,
    },
  ],
};

vi.mock('../entities/contract/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../entities/contract/api')>()),
  useContract: () => ({ isLoading: false, data: contract }),
  recordProvisioning: (...args: unknown[]) => recordProvisioning(...args),
  completeHandover: (...args: unknown[]) => completeHandover(...args),
  swapDevice: vi.fn(),
  fetchHandoverPreview: (...args: unknown[]) => fetchHandoverPreview(...args),
}));

vi.mock('../entities/organization/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../entities/organization/api')>()),
  useOrganization: () => ({ data: { id: 'org-1', channelKeyVersion: 1 } }),
  useMembers: () => ({
    data: [
      {
        id: 'm-1',
        userId: 'u-mgr',
        fullName: 'Demo Manager',
        role: 'MANAGER',
        invitationPending: false,
        deactivatedAt: null,
      },
      {
        id: 'm-2',
        userId: 'u-op',
        fullName: 'Demo Operator',
        role: 'OPERATOR',
        invitationPending: false,
        deactivatedAt: null,
      },
    ],
  }),
}));

vi.mock('../entities/billing/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../entities/billing/api')>()),
  useInvoices: () => ({ data: { items: [{ id: 'inv-1', issuedAt: '2026-01-01T00:00:00Z' }] } }),
  useInvoice: () => ({
    data: {
      id: 'inv-1',
      number: 'INV-2026-000002',
      lines: [{ seq: 1, description: 'Holding fee', amountVnd: 1_125_000, paidVnd: 0 }],
      payments: [],
    },
    refetch: refetchInvoice,
  }),
}));

// jsdom has no canvas: the stub signs with one click.
vi.mock('../widgets/SignaturePad/SignaturePad', () => ({
  SignaturePad: ({ onChange }: { onChange: (png: string) => void }) => (
    <button type="button" onClick={() => onChange('data:image/png;base64,iVBORw0KGgo=')}>
      Sign here
    </button>
  ),
}));

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/t/counter/c-1']}>
        <Routes>
          <Route path="/t/counter/:contractId" element={<CounterPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

const next = () => fireEvent.click(screen.getByRole('button', { name: 'Next' }));

// Provisions both units and enters a battery reading and a GPS fix for each.
const readyDevices = async () => {
  for (const button of screen.getAllByRole('button', { name: 'Record provisioning' })) {
    fireEvent.click(button);
  }
  await waitFor(() => expect(screen.getAllByText('Provisioned v1')).toHaveLength(2));
  screen
    .getAllByLabelText('Battery %')
    .forEach((input) => fireEvent.change(input, { target: { value: '90' } }));
  screen.getAllByLabelText('GPS fix').forEach((box) => fireEvent.click(box));
};

const toSignStep = async () => {
  await readyDevices();
  next();
  next();
  next();
  fireEvent.change(screen.getByLabelText('Signing Manager'), { target: { value: 'u-mgr' } });
  fireEvent.change(screen.getByLabelText('Identity document checked'), {
    target: { value: 'CCCD ending 1234' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Sign here' }));
};

// Five reserved units, TL-0003 to TL-0007, for the bulk actions (dry run defect 4).
const fiveUnits = (overrides: Record<string, unknown> = {}) =>
  [1, 2, 3, 4, 5].map((n) => ({
    deviceId: `d-${n}`,
    assetTag: `TL-000${n + 2}`,
    handedOverAt: null,
    checkedInAt: null,
    lostAt: null,
    holder: null,
    ...((overrides[`d-${n}`] as object | undefined) ?? {}),
  }));

const withDevices = async (devices: typeof contract.devices, body: () => Promise<void>) => {
  const before = contract.devices;
  contract.devices = devices;
  try {
    await body();
  } finally {
    contract.devices = before;
  }
};

const rowBox = (tag: string) => screen.getByLabelText(`Select ${tag}`) as HTMLInputElement;

beforeEach(() => {
  fetchHandoverPreview.mockResolvedValue({ pdfBase64: null, sha256: null });
  recordProvisioning.mockImplementation((_id: string, deviceId: string, keyVersion: number) =>
    Promise.resolve({ deviceId, keyVersion }),
  );
});

afterEach(() => {
  cleanup();
  recordProvisioning.mockReset();
  completeHandover.mockReset();
  fetchHandoverPreview.mockReset();
});

describe('CounterPage (screen 5.4)', () => {
  it('keeps the provisioning recorded before a reload, from the contract read (frontend 5.4)', async () => {
    const before = contract.devices;
    contract.devices = before.map((device) => ({ ...device, provisionedKeyVersion: 1 }));
    try {
      renderPage();
      await waitFor(() => expect(screen.getAllByText('Provisioned v1')).toHaveLength(2));
      expect(screen.queryByText('Not provisioned yet')).toBeNull();
      expect(recordProvisioning).not.toHaveBeenCalled();
    } finally {
      contract.devices = before;
    }
  });

  it('keeps step 1 until every unit is provisioned, read and has a GPS fix', async () => {
    renderPage();
    next();
    expect(
      screen.getAllByText("Provision this device with the organization's key before handover."),
    ).toHaveLength(2);
    await readyDevices();
    next();
    expect(screen.getByRole('heading', { name: '2. Payment' })).toBeTruthy();
    expect(screen.getByText('The first payment is not recorded yet.')).toBeTruthy();
  });

  it('keeps the title and steps in the sticky header and Back and Next in the action bar', async () => {
    renderPage();
    const title = await screen.findByRole('heading', { level: 1, name: /Counter handover/ });
    const header = title.closest('[data-compact]')!;
    expect(within(header as HTMLElement).getByRole('list', { name: 'Steps' })).toBeTruthy();
    const bar = screen.getByRole('group', { name: 'Handover steps' });
    expect(within(bar).getByRole('button', { name: 'Back' })).toBeTruthy();
    expect(within(bar).getByRole('button', { name: 'Next' })).toBeTruthy();
    await readyDevices();
    next();
    next();
    next();
    const submit = within(bar).getByRole('button', { name: 'Complete handover' });
    expect(submit.getAttribute('form')).toBe('handover-sign-form');
    expect(within(bar).queryByRole('button', { name: 'Next' })).toBeNull();
  });

  it('answers an asset tag of another contract with MSG12', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Scan or type an asset tag'), {
      target: { value: 'TL-9999' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Find' }));
    expect(screen.getByText('TL-9999 does not belong to contract RC-2026-0002.')).toBeTruthy();
  });

  it('lists only active Managers as signers and requires every field', async () => {
    renderPage();
    await readyDevices();
    next();
    next();
    next();
    const options = Array.from(screen.getByLabelText('Signing Manager').querySelectorAll('option'));
    expect(options.map((option) => option.textContent)).toEqual([
      'Choose a Manager',
      'Demo Manager',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Complete handover' }));
    expect(screen.getByText('Choose the signing Manager.')).toBeTruthy();
    expect(screen.getByText('The Manager signs in the box.')).toBeTruthy();
    expect(completeHandover).not.toHaveBeenCalled();
  });

  it('holds a low battery behind Proceed anyway, then shows the issued devices (MSG19, MSG06)', async () => {
    completeHandover
      .mockRejectedValueOnce(
        new ApiError(
          409,
          'LOW_BATTERY',
          'Battery below 50 % on TL-0003. Charge before use, or acknowledge.',
        ),
      )
      .mockResolvedValueOnce({ code: 'RC-2026-0002', devicesHandedOver: 2 });
    renderPage();
    await toSignStep();
    fireEvent.click(screen.getByRole('button', { name: 'Complete handover' }));
    await waitFor(() => expect(screen.getByText(/Battery below 50 %/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Proceed anyway' }));
    await waitFor(() => expect(screen.getByText(/2 devices issued/)).toBeTruthy());
    expect(completeHandover).toHaveBeenLastCalledWith('c-1', {
      signedByMemberId: 'u-mgr',
      identityChecked: 'CCCD ending 1234',
      signaturePng: 'data:image/png;base64,iVBORw0KGgo=',
      deviceChecks: [
        { deviceId: 'd-1', batteryPct: 90, gpsFixOk: true },
        { deviceId: 'd-2', batteryPct: 90, gpsFixOk: true },
      ],
      acknowledgeLowBattery: true,
      expectedVersion: 3,
    });
  });

  it('returns to the device step and marks the unit the server names (DEVICE_CHECK_FAILED)', async () => {
    completeHandover.mockRejectedValueOnce(
      new ApiError(409, 'DEVICE_CHECK_FAILED', 'TL-0004 failed the GPS check; swap it first.'),
    );
    renderPage();
    await toSignStep();
    fireEvent.click(screen.getByRole('button', { name: 'Complete handover' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: '1. Devices' })).toBeTruthy());
    expect(
      screen.getAllByText('This device failed the GPS check. Swap it before handover.'),
    ).toHaveLength(1);
  });

  it('sends the battery and GPS readings with the note preview (dry run defect 7)', async () => {
    renderPage();
    await readyDevices();
    next();
    next();
    await waitFor(() => expect(fetchHandoverPreview).toHaveBeenCalled());
    expect(fetchHandoverPreview).toHaveBeenLastCalledWith('c-1', [
      { deviceId: 'd-1', batteryPct: 90, gpsFixOk: true },
      { deviceId: 'd-2', batteryPct: 90, gpsFixOk: true },
    ]);
  });
});

describe('CounterPage bulk device actions (dry run defect 4)', () => {
  it('selects and clears every unit with Select all', async () => {
    await withDevices(fiveUnits(), async () => {
      renderPage();
      const all = screen.getByLabelText('Select all units') as HTMLInputElement;
      fireEvent.click(rowBox('TL-0004'));
      expect(all.indeterminate).toBe(true);
      expect(screen.getByText('1 of 5 selected')).toBeTruthy();
      fireEvent.click(all);
      expect(screen.getByText('5 of 5 selected')).toBeTruthy();
      expect(
        ['TL-0003', 'TL-0004', 'TL-0005', 'TL-0006', 'TL-0007'].map((tag) => rowBox(tag).checked),
      ).toEqual([true, true, true, true, true]);
      fireEvent.click(all);
      expect(screen.getByText('0 of 5 selected')).toBeTruthy();
      expect(
        (
          screen.getByRole('button', {
            name: 'Record provisioning for selected',
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
    });
  });

  it('provisions five units one by one, stops at the failure and keeps it selected', async () => {
    recordProvisioning.mockImplementation((_id: string, deviceId: string, keyVersion: number) =>
      deviceId === 'd-3'
        ? Promise.reject(
            new ApiError(
              409,
              'INVALID_STATE_TRANSITION',
              'This cannot be done while it is CANCELLED.',
            ),
          )
        : Promise.resolve({ deviceId, keyVersion }),
    );
    await withDevices(fiveUnits(), async () => {
      renderPage();
      fireEvent.click(screen.getByLabelText('Select all units'));
      fireEvent.click(screen.getByRole('button', { name: 'Record provisioning for selected' }));
      await waitFor(() =>
        expect(screen.getByText(/Stopped at TL-0005: 2 of 5 recorded/)).toBeTruthy(),
      );
      expect(recordProvisioning.mock.calls.map((call) => call[1])).toEqual(['d-1', 'd-2', 'd-3']);
      expect(screen.getAllByText('Provisioned v1')).toHaveLength(2);
      expect(screen.getByText('This cannot be done while it is CANCELLED.')).toBeTruthy();
      expect(
        ['TL-0003', 'TL-0004', 'TL-0005', 'TL-0006', 'TL-0007'].map((tag) => rowBox(tag).checked),
      ).toEqual([false, false, true, true, true]);
    });
  });

  it('skips a unit already provisioned at the current key version, with a note', async () => {
    await withDevices(fiveUnits({ 'd-1': { provisionedKeyVersion: 1 } }), async () => {
      renderPage();
      fireEvent.click(rowBox('TL-0003'));
      fireEvent.click(rowBox('TL-0004'));
      fireEvent.click(screen.getByRole('button', { name: 'Record provisioning for selected' }));
      await waitFor(() =>
        expect(
          screen.getByText('Recorded 1 of 1. Skipped TL-0003: already provisioned v1.'),
        ).toBeTruthy(),
      );
      expect(recordProvisioning).toHaveBeenCalledTimes(1);
      expect(recordProvisioning).toHaveBeenCalledWith('c-1', 'd-2', 1);
      expect(screen.getByText('0 of 5 selected')).toBeTruthy();
    });
  });

  it('sets the battery and the GPS fix once for the selected units', async () => {
    await withDevices(fiveUnits(), async () => {
      renderPage();
      fireEvent.click(screen.getByLabelText('Select all units'));
      fireEvent.click(rowBox('TL-0007'));
      fireEvent.change(screen.getByLabelText('Battery % for selected'), {
        target: { value: '101' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Set readings for selected' }));
      expect(screen.getByText('Enter the battery as a whole number from 0 to 100.')).toBeTruthy();
      fireEvent.change(screen.getByLabelText('Battery % for selected'), {
        target: { value: '85' },
      });
      fireEvent.change(screen.getByLabelText('GPS fix for selected'), { target: { value: 'ok' } });
      fireEvent.click(screen.getByRole('button', { name: 'Set readings for selected' }));
      expect(screen.getByText('Readings set on 4 units.')).toBeTruthy();
      expect(
        screen.getAllByLabelText('Battery %').map((input) => (input as HTMLInputElement).value),
      ).toEqual(['85', '85', '85', '85', '']);
      expect(
        screen.getAllByLabelText('GPS fix').map((box) => (box as HTMLInputElement).checked),
      ).toEqual([true, true, true, true, false]);
    });
  });
});
