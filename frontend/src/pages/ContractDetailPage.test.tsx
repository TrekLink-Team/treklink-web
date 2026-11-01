// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContractDetailPage } from './ContractDetailPage';

let contract: Record<string, unknown>;
let variants: { id: string; code: string; name: string }[] | undefined;
let roles: string[] = ['STAFF'];
let closeCheck: Record<string, unknown> | undefined;

const baseContract = {
  id: 'c-1',
  code: 'RC-2026-0004',
  organization: { id: 'org-1', code: 'ORG-0001', legalName: 'Acme Trek' },
  planType: 'MONTHLY',
  dayPlanDays: null,
  hardwareVariant: { id: 'v-3', code: 'treklink-v3' },
  quantity: 5,
  requestedStartDate: '2026-10-30',
  monthlyUnitPriceVnd: 450_000,
  dayPremium: null,
  holdingFeeRatio: 0.5,
  status: 'APPROVED',
  statusChangedAt: '2026-10-30T02:00:00Z',
  handedOverAt: null,
  currentTerm: null,
  endsAt: null,
  noticeGivenAt: null,
  returnDueAt: null,
  handoverAppointmentAt: '2026-10-30T09:00:00Z',
  reservationExpiresAt: '2026-10-31T09:00:00Z',
  version: 2,
  terms: [],
  devices: [],
  balance: { dueNowVnd: 0, dueLaterVnd: 0 },
};

vi.mock('../app/providers/useAuth', () => ({
  useAuth: () => ({ user: { roles } }),
}));

vi.mock('../entities/contract/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../entities/contract/api')>()),
  useContract: () => ({ isLoading: false, isSuccess: true, data: contract }),
  useTransitions: () => ({ data: [] }),
  useCloseCheck: (_id: string, enabled: boolean) => ({
    isLoading: false,
    error: null,
    data: enabled ? closeCheck : undefined,
    refetch: vi.fn(),
  }),
}));

vi.mock('../entities/billing/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../entities/billing/api')>()),
  useBalance: () => ({ data: undefined }),
}));

// The public plans read (billing api-design 01) answers the variant names; nothing else is fetched.
vi.mock('../shared/api/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/api/apiClient')>()),
  apiClient: (endpoint: string) =>
    endpoint === '/plans' && variants
      ? Promise.resolve({ variants })
      : new Promise(() => undefined),
}));

const renderPage = (scope: 'o' | 't' = 't') =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[`/${scope}/contracts/c-1`]}>
        <Routes>
          <Route path={`/${scope}/contracts/:id`} element={<ContractDetailPage scope={scope} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('ContractDetailPage', () => {
  beforeEach(() => {
    contract = { ...baseContract };
    roles = ['STAFF'];
    variants = [{ id: 'v-3', code: 'treklink-v3', name: 'TrekLink v3' }];
    closeCheck = undefined;
  });

  afterEach(() => cleanup());

  it('names the variant by the display name the request form shows', async () => {
    renderPage();
    expect(await screen.findByText('Monthly, 5 x TrekLink v3 for Acme Trek')).toBeTruthy();
    expect(screen.getByText('5 x TrekLink v3')).toBeTruthy();
    expect(screen.queryByText(/treklink-v3/)).toBeNull();
  });

  it('falls back to the variant code until the plans read answers', () => {
    variants = undefined;
    renderPage();
    expect(screen.getByText('5 x treklink-v3')).toBeTruthy();
  });

  it('links a handed-over device to its telemetry history, and a reserved one to nothing', () => {
    const row = (deviceId: string, assetTag: string, handedOverAt: string | null) => ({
      deviceId,
      assetTag,
      holder: null,
      handedOverAt,
      checkedInAt: null,
      lostAt: null,
    });
    contract = {
      ...baseContract,
      status: 'ACTIVE',
      devices: [row('d-1', 'TL-0009', '2026-10-30T09:30:00Z'), row('d-2', 'TL-0010', null)],
    };
    renderPage();
    const links = screen.getAllByRole('link', { name: 'History' });
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('/t/devices/d-1/telemetry');
  });

  it('shows the reservation expiry while the contract is APPROVED', () => {
    renderPage();
    expect(screen.getByText('Reservation expires')).toBeTruthy();
  });

  it.each(['ACTIVE', 'ENDING', 'RETURN_DUE', 'CANCELLED', 'CLOSED'])(
    'hides the reservation expiry once the contract is %s',
    (status) => {
      contract = { ...baseContract, status, handedOverAt: '2026-10-30T09:30:00Z' };
      renderPage();
      expect(screen.queryByText('Reservation expires')).toBeNull();
    },
  );

  it('offers the Org Manager Report lost on a device that is out, and opens the dialog (screen 4.4)', () => {
    roles = ['ORG_MANAGER'];
    const row = { holder: null, checkedInAt: null, lostAt: null, handedOverAt: '2026-10-30T09:00:00Z' };
    contract = {
      ...baseContract,
      status: 'ACTIVE',
      devices: [
        { ...row, deviceId: 'dev-1', assetTag: 'TL-0042' },
        { ...row, deviceId: 'dev-2', assetTag: 'TL-0043', checkedInAt: '2026-10-31T09:00:00Z' },
      ],
    };
    renderPage('o');
    const report = screen.getAllByRole('button', { name: 'Report lost' });
    expect(report).toHaveLength(1);
    fireEvent.click(report[0]);
    expect(screen.getByRole('dialog', { name: 'Report TL-0042 lost' })).toBeTruthy();
  });

  // D-092 rule 3: the close action is visible to Staff whenever the close check passes, and the page
  // says what still blocks it otherwise.
  const backRow = (deviceId: string, assetTag: string, afterReturn: unknown) => ({
    deviceId,
    assetTag,
    holder: null,
    handedOverAt: '2026-10-30T09:00:00Z',
    checkedInAt: '2026-11-01T02:00:00Z',
    lostAt: null,
    afterReturn,
  });

  it('shows Staff the Close action when the close check passes', () => {
    contract = { ...baseContract, status: 'RETURNED', handedOverAt: '2026-10-30T09:00:00Z' };
    closeCheck = { contractId: 'c-1', status: 'RETURNED', version: 9, canClose: true, blockers: [] };
    renderPage();
    expect(screen.getByText('Nothing blocks the close.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close contract' }));
    expect(screen.getByRole('dialog', { name: 'Close contract RC-2026-0004?' })).toBeTruthy();
  });

  it('lists what blocks the close with Report lost for a missing unit, and no Close action', () => {
    contract = { ...baseContract, status: 'RETURN_DUE', handedOverAt: '2026-10-30T09:00:00Z' };
    closeCheck = {
      contractId: 'c-1',
      status: 'RETURN_DUE',
      version: 9,
      canClose: false,
      blockers: [
        {
          code: 'DEVICE_OUT',
          message: 'TL-0011 is not back. Check it in, or report it lost.',
          deviceId: 'd-11',
          assetTag: 'TL-0011',
          lossCase: null,
        },
        {
          code: 'BALANCE_OUTSTANDING',
          message: "1,525,000 VND is unpaid on the contract's invoices.",
          amountVnd: 1_525_000,
        },
      ],
    };
    renderPage();
    expect(screen.getByText('What still blocks the close')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Close contract' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Report TL-0011 lost' }));
    expect(screen.getByRole('dialog', { name: 'Report TL-0011 lost' })).toBeTruthy();
  });

  it('shows each returned unit state and its next step to Staff (D-092 rule 4)', () => {
    contract = {
      ...baseContract,
      status: 'RETURNED',
      handedOverAt: '2026-10-30T09:00:00Z',
      devices: [
        backRow('d-3', 'TL-0003', { status: 'AVAILABLE', nextStep: null }),
        backRow('d-4', 'TL-0004', {
          status: 'RETURNED',
          nextStep: { action: 'INSPECT', contractId: 'c-1' },
        }),
        backRow('d-6', 'TL-0006', {
          status: 'MAINTENANCE',
          nextStep: { action: 'INTAKE', contractId: null },
        }),
      ],
    };
    closeCheck = { contractId: 'c-1', status: 'RETURNED', version: 9, canClose: true, blockers: [] };
    renderPage();
    expect(screen.getByRole('columnheader', { name: 'State now' })).toBeTruthy();
    expect(screen.getByText('Available')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Next: Inspect' }).getAttribute('href')).toBe(
      '/t/counter/c-1',
    );
    expect(screen.getByRole('link', { name: 'Next: Intake check' }).getAttribute('href')).toBe(
      '/t/devices/d-6',
    );
  });

  it('never shows the close panel or the unit state to the Org Manager', () => {
    roles = ['ORG_MANAGER'];
    contract = {
      ...baseContract,
      status: 'RETURNED',
      handedOverAt: '2026-10-30T09:00:00Z',
      devices: [backRow('d-3', 'TL-0003', null)],
    };
    closeCheck = { contractId: 'c-1', status: 'RETURNED', version: 9, canClose: true, blockers: [] };
    renderPage('o');
    expect(screen.queryByRole('button', { name: 'Close contract' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'State now' })).toBeNull();
  });

  it('never offers Report lost to an Org Operator', () => {
    roles = ['ORG_OPERATOR'];
    contract = {
      ...baseContract,
      status: 'ACTIVE',
      devices: [{ deviceId: 'dev-1', assetTag: 'TL-0042', holder: null, checkedInAt: null, lostAt: null, handedOverAt: '2026-10-30T09:00:00Z' }],
    };
    renderPage('o');
    expect(screen.queryByRole('button', { name: 'Report lost' })).toBeNull();
  });
});
