// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContractDetailPage } from './ContractDetailPage';

let contract: Record<string, unknown>;
let variants: { id: string; code: string; name: string }[] | undefined;
let roles: string[] = ['STAFF'];
let closeCheck: Record<string, unknown> | undefined;
let history: Record<string, unknown>[] = [];

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
  useTransitions: () => ({ data: history }),
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

const renderPage = (
  scope: 'o' | 't' = 't',
  query = '',
  handover?: (contractId: string, onDone: () => void) => React.ReactNode,
) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[`/${scope}/contracts/c-1${query}`]}>
        <Routes>
          <Route
            path={`/${scope}/contracts/:id`}
            element={<ContractDetailPage scope={scope} handover={handover} />}
          />
          <Route path="/t/counter/:contractId" element={<p>Counter page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

const actionRow = () => screen.getByRole('region', { name: 'Contract sections and actions' });

describe('ContractDetailPage', () => {
  beforeEach(() => {
    contract = { ...baseContract };
    roles = ['STAFF'];
    variants = [{ id: 'v-3', code: 'treklink-v3', name: 'TrekLink v3' }];
    closeCheck = undefined;
    history = [];
  });

  afterEach(() => cleanup());

  it('names the variant by the display name the request form shows', async () => {
    renderPage();
    expect(await screen.findByText('5 x TrekLink v3')).toBeTruthy();
    expect(screen.getByText('Acme Trek ·', { exact: false })).toBeTruthy();
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
    renderPage('t', '?tab=devices');
    const links = screen.getAllByRole('link', { name: 'History' });
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('/t/devices/d-1/telemetry');
  });

  it('shows each asset tag as a link to the device home, and the history of the unit to an organization', () => {
    const row = (deviceId: string, assetTag: string) => ({
      deviceId,
      assetTag,
      holder: null,
      handedOverAt: '2026-10-30T09:30:00Z',
      checkedInAt: null,
      lostAt: null,
    });
    contract = { ...baseContract, status: 'ACTIVE', devices: [row('d-1', 'TL-0009')] };

    renderPage('t', '?tab=devices');
    expect(screen.getByRole('link', { name: 'TL-0009' }).getAttribute('href')).toBe(
      '/t/devices/d-1',
    );
    cleanup();

    renderPage('o', '?tab=devices');
    expect(screen.getByRole('link', { name: 'TL-0009' }).getAttribute('href')).toBe(
      '/o/devices/d-1/telemetry',
    );
    expect(screen.queryByRole('link', { name: 'History' })).toBeNull();
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
    const row = {
      holder: null,
      checkedInAt: null,
      lostAt: null,
      handedOverAt: '2026-10-30T09:00:00Z',
    };
    contract = {
      ...baseContract,
      status: 'ACTIVE',
      devices: [
        { ...row, deviceId: 'dev-1', assetTag: 'TL-0042' },
        { ...row, deviceId: 'dev-2', assetTag: 'TL-0043', checkedInAt: '2026-10-31T09:00:00Z' },
      ],
    };
    renderPage('o', '?tab=devices');
    // Item actions are named after the unit (chapter 06 §9.5, 2.5.3): "Report lost TL-0042".
    const report = screen.getAllByRole('button', { name: /^Report lost/ });
    expect(report).toHaveLength(1);
    expect(report[0].getAttribute('aria-label')).toBe('Report lost TL-0042');
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
    closeCheck = {
      contractId: 'c-1',
      status: 'RETURNED',
      version: 9,
      canClose: true,
      blockers: [],
    };
    renderPage();
    expect(screen.getByText('Nothing blocks the close.')).toBeTruthy();
    // Close contract is also the primary action of a returned contract, in the sticky row.
    fireEvent.click(within(actionRow()).getByRole('button', { name: 'Close contract' }));
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
    // Record return is the primary action; Close contract waits in More actions with its reason.
    expect(within(actionRow()).getByRole('button', { name: 'Record return' })).toBeTruthy();
    fireEvent.click(within(actionRow()).getByRole('button', { name: 'More actions' }));
    const close = screen.getByRole('menuitem', { name: 'Close contract' });
    expect(close.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('TL-0011 is not back. Check it in, or report it lost.', { selector: '[role="menuitem"] span' })).toBeTruthy();
    fireEvent.keyDown(close, { key: 'Escape' });
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
    closeCheck = {
      contractId: 'c-1',
      status: 'RETURNED',
      version: 9,
      canClose: true,
      blockers: [],
    };
    renderPage('t', '?tab=devices');
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
    closeCheck = {
      contractId: 'c-1',
      status: 'RETURNED',
      version: 9,
      canClose: true,
      blockers: [],
    };
    renderPage('o');
    expect(screen.queryByRole('button', { name: 'Close contract' })).toBeNull();
    cleanup();
    renderPage('o', '?tab=devices');
    expect(screen.queryByRole('columnheader', { name: 'State now' })).toBeNull();
  });

  it('never offers Report lost to an Org Operator', () => {
    roles = ['ORG_OPERATOR'];
    contract = {
      ...baseContract,
      status: 'ACTIVE',
      devices: [
        {
          deviceId: 'dev-1',
          assetTag: 'TL-0042',
          holder: null,
          checkedInAt: null,
          lostAt: null,
          handedOverAt: '2026-10-30T09:00:00Z',
        },
      ],
    };
    renderPage('o', '?tab=devices');
    expect(screen.queryByRole('button', { name: /^Report lost/ })).toBeNull();
  });

  // Screen 6.5 (billing api-design 18): a unit back with a FAILED inspection gets the request.
  it('offers Staff a service credit request only on a unit back with a FAILED inspection', () => {
    contract = {
      ...baseContract,
      status: 'RETURNED',
      handedOverAt: '2026-10-30T09:00:00Z',
      devices: [
        {
          ...backRow('d-3', 'TL-0003', null),
          contractDeviceId: 'cd-3',
          inspection: { id: 'in-3', result: 'FAILED', at: '2026-11-01T03:00:00Z' },
        },
        {
          ...backRow('d-4', 'TL-0004', null),
          contractDeviceId: 'cd-4',
          inspection: { id: 'in-4', result: 'PASSED', at: '2026-11-01T03:00:00Z' },
        },
      ],
    };
    closeCheck = {
      contractId: 'c-1',
      status: 'RETURNED',
      version: 9,
      canClose: true,
      blockers: [],
    };
    renderPage('t', '?tab=devices');
    const requests = screen.getAllByRole('button', { name: /^Request service credit/ });
    expect(requests).toHaveLength(1);
    fireEvent.click(requests[0]);
    expect(
      screen.getByRole('dialog', { name: 'Request a service credit for TL-0003' }),
    ).toBeTruthy();
    cleanup();
    renderPage('t', '?tab=money');
    expect(screen.getByRole('heading', { name: 'Service credits' })).toBeTruthy();
  });

  it('never offers the service credit request to the Org Manager', () => {
    roles = ['ORG_MANAGER'];
    contract = {
      ...baseContract,
      status: 'RETURNED',
      handedOverAt: '2026-10-30T09:00:00Z',
      devices: [
        {
          ...backRow('d-3', 'TL-0003', null),
          contractDeviceId: 'cd-3',
          inspection: { id: 'in-3', result: 'FAILED', at: '2026-11-01T03:00:00Z' },
        },
      ],
    };
    renderPage('o', '?tab=devices');
    expect(screen.queryByRole('button', { name: /^Request service credit/ })).toBeNull();
    cleanup();
    renderPage('o', '?tab=money');
    expect(screen.getByRole('heading', { name: 'Service credits' })).toBeTruthy();
  });

  // The contract home of chapter 06 §10.4 (D-096).
  describe('contract home', () => {
    it('draws the lifecycle from the state machine with the current step and the Next step', () => {
      contract = { ...baseContract, status: 'APPROVED' };
      renderPage();
      const steps = within(screen.getByRole('list', { name: 'Lifecycle steps' })).getAllByRole('listitem');
      const labels = ['Requested', 'Approved', 'Active', 'Ending', 'Return due', 'Returned', 'Closed'];
      expect(steps).toHaveLength(labels.length);
      steps.forEach((step, index) => expect(step.textContent).toContain(labels[index]));
      expect(steps[1].getAttribute('aria-current')).toBe('step');
      expect(steps[0].textContent).toContain('Completed: Requested');
      expect(steps[2].textContent).toContain('Not yet: Active');
      const card = screen.getByRole('region', { name: 'Contract lifecycle' });
      expect(within(card).getByText('Next step')).toBeTruthy();
      expect(within(card).getByText(/^Hand over 5 units at the counter/)).toBeTruthy();
    });

    it('leaves out Ending on a day plan and marks an exit as a branch marker on its step', () => {
      contract = { ...baseContract, planType: 'DAY', dayPlanDays: 5, status: 'CANCELLED' };
      history = [
        { fromStatus: null, toStatus: 'REQUESTED', actor: 'Manager', reason: null, createdAt: '2026-10-28T02:00:00Z' },
        { fromStatus: 'REQUESTED', toStatus: 'APPROVED', actor: 'Staff', reason: null, createdAt: '2026-10-29T02:00:00Z' },
        { fromStatus: 'APPROVED', toStatus: 'CANCELLED', actor: 'Staff', reason: 'No show', createdAt: '2026-10-30T02:00:00Z' },
      ];
      renderPage();
      const steps = within(screen.getByRole('list', { name: 'Lifecycle steps' })).getAllByRole('listitem');
      expect(steps).toHaveLength(6);
      expect(steps.some((step) => step.textContent?.includes('Ending'))).toBe(false);
      expect(steps[1].textContent).toContain('Left the path here: ');
      expect(steps[1].textContent).toContain('Cancelled');
      expect(steps[2].textContent).toContain('Not reached: Active');
    });

    it('gives Staff one primary action per state and Review mode in place of the tab body', () => {
      contract = { ...baseContract, status: 'REQUESTED', holdExpiresAt: '2099-11-05T03:15:00Z' };
      renderPage();
      const row = actionRow();
      expect(within(row).getByRole('tablist', { name: 'Contract sections' })).toBeTruthy();
      fireEvent.click(within(row).getByRole('button', { name: 'Review request' }));
      expect(screen.getByRole('heading', { name: 'Review request' })).toBeTruthy();
      expect(screen.queryByRole('tablist')).toBeNull();
      expect(screen.getByRole('region', { name: 'Review request' })).toBeTruthy();
      expect(screen.getByLabelText('Handover appointment')).toBeTruthy();
      const approve = within(actionRow()).getByRole('button', { name: 'Approve request' });
      expect(approve.getAttribute('type')).toBe('submit');
      expect(approve.getAttribute('form')).toBe('contract-review-form');
      expect(screen.getByRole('link', { name: 'Back to overview' }).getAttribute('href')).toBe('/t/contracts/c-1');
    });

    it('puts destructive actions last in More actions, behind a dialog', () => {
      contract = { ...baseContract, status: 'REQUESTED' };
      renderPage('t', '?mode=review');
      fireEvent.click(within(actionRow()).getByRole('button', { name: 'More actions' }));
      const menu = screen.getByRole('menu');
      expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
        'Leave review mode',
        'Reject request',
        'Cancel request',
      ]);
      expect(within(menu).getByRole('separator')).toBeTruthy();
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Reject request' }));
      expect(screen.getByRole('alertdialog', { name: 'Reject request RC-2026-0004?' })).toBeTruthy();
    });

    it('runs the counter steps in Handover mode, from Start handover', () => {
      const handover = vi.fn((id: string) => <p>Counter steps of {id}</p>);
      renderPage('t', '', handover);
      fireEvent.click(within(actionRow()).getByRole('button', { name: 'Start handover' }));
      expect(screen.getByText('Counter steps of c-1')).toBeTruthy();
      expect(screen.getByRole('heading', { name: 'Handover' })).toBeTruthy();
      expect(within(actionRow()).queryByRole('button', { name: 'Start handover' })).toBeNull();
      fireEvent.click(within(actionRow()).getByRole('button', { name: 'More actions' }));
      expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
        'Leave handover',
        'Cancel contract',
      ]);
    });

    it('keeps the tab in the address and shows an Org Operator only Overview and Devices', () => {
      roles = ['ORG_OPERATOR'];
      contract = { ...baseContract, status: 'ACTIVE', handedOverAt: '2026-10-30T09:00:00Z' };
      renderPage('o', '?tab=money');
      const tabs = within(screen.getByRole('tablist', { name: 'Contract sections' })).getAllByRole('tab');
      expect(tabs.map((tab) => tab.textContent)).toEqual(['Overview', 'Devices0']);
      // A tab the role does not have falls back to Overview.
      expect(tabs[0].getAttribute('aria-selected')).toBe('true');
      expect(screen.getByText('Your role reads this contract')).toBeTruthy();
      fireEvent.click(tabs[1]);
      expect(screen.getByRole('tabpanel').id).toBe('contract-panel-devices');
    });

    it('offers the Org Manager Give notice on an active monthly contract with nothing due', () => {
      roles = ['ORG_MANAGER'];
      contract = { ...baseContract, status: 'ACTIVE', handedOverAt: '2026-10-30T09:00:00Z' };
      renderPage('o');
      fireEvent.click(within(actionRow()).getByRole('button', { name: 'Give notice' }));
      expect(screen.getByRole('dialog')).toBeTruthy();
    });

    it('shows the history with readable labels', () => {
      history = [
        { fromStatus: null, toStatus: 'REQUESTED', actor: 'Linh', reason: null, createdAt: '2026-10-28T02:00:00Z' },
        { fromStatus: 'REQUESTED', toStatus: 'CANCELLED', actor: null, reason: 'HOLD_EXPIRED', createdAt: '2026-10-30T02:00:00Z' },
      ];
      contract = { ...baseContract, status: 'CANCELLED' };
      renderPage('t', '?tab=history');
      expect(screen.getByText('Request cancelled, the unpaid hold expired')).toBeTruthy();
      expect(screen.getByText('Request sent, devices held')).toBeTruthy();
      expect(screen.getByText('System')).toBeTruthy();
    });
  });
});
