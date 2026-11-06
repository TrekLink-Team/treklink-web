// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../shared/api/apiClient';
import { useConnectorStore } from '../features/device-connector';
import { MaintenanceApprovalPage, MaintenancePage } from './MaintenancePage';

// The dialog's date field has min={today}, and jsdom refuses a submit below it, so the expected
// completion is always a date after today.
const TOMORROW = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

const estimateMaintenance = vi.fn();
const completeMaintenance = vi.fn();
const decideMaintenance = vi.fn();
const openMaintenance = vi.fn();

let currentRoles = ['STAFF'];
let currentUserId = 'staff-1';

vi.mock('../app/providers/useAuth', () => ({
  useAuth: () => ({ user: { id: currentUserId, roles: currentRoles } }),
}));

const record = (overrides: Record<string, unknown> = {}) => ({
  id: 'm-1',
  device: { id: 'd-9', assetTag: 'TL-0009' },
  reason: 'SCHEDULED',
  status: 'OPEN',
  description: 'Six-month service',
  expectedAt: '2026-10-20',
  workBy: 'VENDOR',
  vendorName: 'Hoang Long Electronics',
  estimatedCostVnd: 650000,
  estimatedById: 'admin-1',
  approvedCostVnd: null,
  decision: null,
  decisionReason: null,
  actualCostVnd: null,
  warrantyUntil: null,
  checklist: ['Battery health', 'Antenna'],
  checklistResults: null,
  firmwareVersion: null,
  resolution: null,
  openedAt: '2026-10-20T03:15:00.000Z',
  closedAt: null,
  version: 1,
  ...overrides,
});

let thresholdVnd: number | undefined = 1_000_000;
const fetchMaintenanceRecords = vi.fn();

// totalPages above 1 when a test sets `pages`, as a list longer than one page of 20 would answer.
let pages: number | undefined;

const page = (items: unknown[], pageNumber = 1) => ({
  approvalThresholdVnd: thresholdVnd,
  items,
  pageNumber,
  pageSize: 20,
  totalCount: pages ? pages * 20 : items.length,
  totalPages: pages ?? (items.length > 0 ? 1 : 0),
});

let records: unknown[] = [record()];
let approvals: unknown[] = [];
let weekRecords: unknown[] = [];
let devicesOut: unknown[] = [];
const recordFilters: {
  status?: string[];
  reason?: string[];
  dueBefore?: string;
  pageNumber?: number;
  sort?: string;
  order?: string;
}[] = [];
const deviceFilters: { status?: string[]; q?: string }[] = [];

vi.mock('../entities/device/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../entities/device/api')>()),
  useDevice: () => ({ data: { id: 'd-9', assetTag: 'TL-0009', version: 5 } }),
  useDevices: (filters: { status?: string[]; q?: string }) => (deviceFilters.push(filters), {
    data: page(
      filters.status?.includes('AVAILABLE')
        ? [{ id: 'd-9', assetTag: 'TL-0009', status: 'AVAILABLE' }]
        : devicesOut,
    ),
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useMaintenanceRecords: (
    filters: { status?: string[]; dueBefore?: string; pageNumber?: number },
    enabled = true,
  ) => {
    recordFilters.push(filters);
    if (!enabled) return { data: page([]), isLoading: false, error: null, refetch: vi.fn() };
    const items = filters.status?.includes('PENDING_APPROVAL')
      ? approvals
      : filters.dueBefore
        ? weekRecords // empty unless a test sets it, to avoid ambiguous matches
        : records;
    return { data: page(items, filters.pageNumber), isLoading: false, error: null, refetch: vi.fn() };
  },
  estimateMaintenance: (...args: unknown[]) => estimateMaintenance(...args),
  completeMaintenance: (...args: unknown[]) => completeMaintenance(...args),
  decideMaintenance: (...args: unknown[]) => decideMaintenance(...args),
  openMaintenance: (...args: unknown[]) => openMaintenance(...args),
  fetchMaintenanceRecords: (...args: unknown[]) => fetchMaintenanceRecords(...args),
}));

const renderPage = (path = '/t/maintenance') =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/t/maintenance" element={<MaintenancePage />} />
          <Route path="/t/maintenance/approvals" element={<MaintenanceApprovalPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  fetchMaintenanceRecords.mockReset();
  estimateMaintenance.mockReset();
  completeMaintenance.mockReset();
  decideMaintenance.mockReset();
  openMaintenance.mockReset();
  currentRoles = ['STAFF'];
  currentUserId = 'staff-1';
  records = [record()];
  approvals = [];
  weekRecords = [];
  devicesOut = [];
  thresholdVnd = 1_000_000;
  recordFilters.length = 0;
  deviceFilters.length = 0;
  pages = undefined;
});

const table = async () => within(await screen.findByRole('table', { name: 'Maintenance records' }));
afterEach(cleanup);

describe('MaintenancePage (/t/maintenance, screen 4.3)', () => {
  it('lists records with their reason, status and cost', async () => {
    renderPage();
    const rows = await table();
    expect(rows.getByRole('button', { name: 'TL-0009' })).toBeTruthy();
    expect(rows.getByText('Scheduled service')).toBeTruthy();
    expect(rows.getByText('Open')).toBeTruthy();
    expect(rows.getByText(/650,000|650\.000/)).toBeTruthy();
    // W15 panel walk: the expected date read 2026-10-20, unlike every other date of the app.
    expect(rows.getByText('20 Oct 2026')).toBeTruthy();
    expect(rows.queryByText('2026-10-20')).toBeNull();
  });

  it('hides the approvals tab for Staff, and MSG26 on the approvals route', async () => {
    renderPage();
    await table();
    expect(screen.queryByRole('tab', { name: /Approvals/ })).toBeNull();
    renderPage('/t/maintenance/approvals');
    expect(await screen.findByText(/do not have access/i)).toBeTruthy();
  });

  it('estimates an OPEN record, sending the amount and work-by', async () => {
    estimateMaintenance.mockResolvedValue(record({ status: 'OPEN' }));
    renderPage();
    fireEvent.click((await table()).getByRole('button', { name: /^Estimate/ }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText(/Estimated cost/), { target: { value: '700000' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Save estimate' }));
    await waitFor(() =>
      expect(estimateMaintenance).toHaveBeenCalledWith('d-9', 'm-1', {
        workBy: 'VENDOR',
        vendorName: 'Hoang Long Electronics',
        estimatedCostVnd: 700000,
        expectedVersion: 1,
      }),
    );
  });

  it('refuses to complete a SCHEDULED record with a missing checklist item', async () => {
    renderPage();
    fireEvent.click((await table()).getByRole('button', { name: /^Complete/ }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText(/Resolution/), { target: { value: 'Battery replaced' } });
    fireEvent.change(dialog.getByLabelText(/Actual cost/), { target: { value: '500000' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Save' }));
    expect(dialog.getByText('Record every checklist item.')).toBeTruthy();
    expect(completeMaintenance).not.toHaveBeenCalled();
  });

  it('completes a SCHEDULED record once every checklist item is answered', async () => {
    completeMaintenance.mockResolvedValue(record({ status: 'COMPLETED' }));
    renderPage();
    fireEvent.click((await table()).getByRole('button', { name: /^Complete/ }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText(/Resolution/), { target: { value: 'Battery replaced' } });
    fireEvent.change(dialog.getByLabelText(/Actual cost/), { target: { value: '500000' } });
    fireEvent.click(dialog.getByLabelText('Pass', { selector: 'input[name="checklist-Battery health"]' }));
    fireEvent.click(dialog.getByLabelText('Pass', { selector: 'input[name="checklist-Antenna"]' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(completeMaintenance).toHaveBeenCalledWith('d-9', 'm-1', {
        status: 'COMPLETED',
        resolution: 'Battery replaced',
        actualCostVnd: 500000,
        checklistResults: [
          { item: 'Battery health', passed: true },
          { item: 'Antenna', passed: true },
        ],
        expectedVersion: 1,
      }),
    );
  });

  it('hides the decide button on a record the viewer estimated, for an Admin', async () => {
    currentRoles = ['ADMIN'];
    currentUserId = 'admin-1';
    records = [];
    approvals = [record({ status: 'PENDING_APPROVAL' })];
    renderPage();
    await screen.findByRole('tab', { name: /Approvals/ });
    fireEvent.click(screen.getByRole('tab', { name: /Approvals/ }));
    // Reachable, disabled, with its reason (UI standard §2, BR-44).
    expect((await screen.findAllByText('A different Admin must decide this: you recorded the estimate.')).length).toBeGreaterThan(0);
    const decide = within(screen.getByRole('table', { name: 'Costs waiting for a decision' })).getByRole('button', { name: /^Decide/ });
    expect(decide.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(decide);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('decides a pending cost for a different Admin', async () => {
    currentRoles = ['ADMIN'];
    currentUserId = 'admin-2';
    records = [];
    approvals = [record({ status: 'PENDING_APPROVAL' })];
    decideMaintenance.mockResolvedValue(record({ status: 'OPEN' }));
    renderPage();
    await screen.findByRole('tab', { name: /Approvals/ });
    fireEvent.click(screen.getByRole('tab', { name: /Approvals/ }));
    fireEvent.click(
      within(await screen.findByRole('table', { name: 'Costs waiting for a decision' })).getByRole('button', {
        name: /^Decide/,
      }),
    );
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText(/Approved amount/), { target: { value: '600000' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Save decision' }));
    await waitFor(() =>
      expect(decideMaintenance).toHaveBeenCalledWith('d-9', 'm-1', {
        decision: 'APPROVED',
        approvedCostVnd: 600000,
        expectedVersion: 1,
      }),
    );
  });

  it('shows SEPARATION_OF_DUTY when the decision is forced', async () => {
    currentRoles = ['ADMIN'];
    currentUserId = 'admin-2';
    records = [];
    approvals = [record({ status: 'PENDING_APPROVAL' })];
    decideMaintenance.mockRejectedValueOnce(
      new ApiError(403, 'SEPARATION_OF_DUTY', 'A different Admin must approve this cost.'),
    );
    renderPage();
    await screen.findByRole('tab', { name: /Approvals/ });
    fireEvent.click(screen.getByRole('tab', { name: /Approvals/ }));
    fireEvent.click(
      within(await screen.findByRole('table', { name: 'Costs waiting for a decision' })).getByRole('button', {
        name: /^Decide/,
      }),
    );
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText(/Approved amount/), { target: { value: '600000' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Save decision' }));
    expect(await screen.findByText('A different Admin must approve this cost.')).toBeTruthy();
  });

  it('opens the record a device history row names, from recordId in the navigation state (W20B)', async () => {
    // devices api-design 15 has no read by id: the page reads the list until the record turns up.
    fetchMaintenanceRecords.mockImplementation(({ pageNumber }: { pageNumber: number }) =>
      Promise.resolve({
        ...page(pageNumber === 1 ? [record()] : [record({ id: 'm-7', description: 'Antenna loose' })], pageNumber),
        totalPages: 2,
      }),
    );
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[{ pathname: '/t/maintenance', state: { recordId: 'm-7' } }]}>
          <Routes>
            <Route path="/t/maintenance" element={<MaintenancePage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const drawer = await screen.findByRole('dialog', { name: 'Maintenance on TL-0009' });
    expect(within(drawer).getByText('Antenna loose')).toBeTruthy();
    expect(fetchMaintenanceRecords.mock.calls.map(([filters]) => filters.pageNumber)).toEqual([1, 2]);
    // Closed, it stays closed.
    fireEvent.click(within(drawer).getAllByRole('button', { name: /Close/ })[0]);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Maintenance on TL-0009' })).toBeNull());
  });

  // devices task 8.3 (design section 9.2): the record opens the device hub on its unit, and a verified
  // flash comes back with the release version filled into Complete.
  it('opens the device hub on the unit of an open firmware update record', async () => {
    records = [record({ id: 'm-8', reason: 'FIRMWARE_UPDATE', description: 'Update firmware' })];
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Show details/ }));
    const drawer = await screen.findByRole('dialog', { name: 'Maintenance on TL-0009' });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Update firmware' }));
    expect(useConnectorStore.getState()).toMatchObject({ open: true, focus: { action: 'flash', assetTag: 'TL-0009' } });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Maintenance on TL-0009' })).toBeNull());
    act(() => useConnectorStore.setState({ open: false, focus: null }));
  });

  it('opens Complete with the flashed firmware version after a verified flash', async () => {
    fetchMaintenanceRecords.mockImplementation(() =>
      Promise.resolve(page([record({ id: 'm-8', reason: 'FIRMWARE_UPDATE', description: 'Update firmware' })])),
    );
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter
          initialEntries={[{ pathname: '/t/maintenance', state: { recordId: 'm-8', flashedVersion: '2.7.26-treklink.2' } }]}
        >
          <Routes>
            <Route path="/t/maintenance" element={<MaintenancePage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const complete = await screen.findByRole('dialog', { name: 'Complete maintenance for TL-0009' });
    expect((within(complete).getByLabelText(/Firmware version/) as HTMLInputElement).value).toBe('2.7.26-treklink.2');
    fireEvent.click(within(complete).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Complete maintenance for TL-0009' })).toBeNull());
  });

  it('clears recordId from the history entry once the record is open, so Back and Forward do not reopen it', async () => {
    fetchMaintenanceRecords.mockResolvedValue({ ...page([record({ id: 'm-7' })]), totalPages: 1 });
    // Stands in for the history controls and shows the state of the current entry.
    const History: React.FC = () => {
      const location = useLocation();
      const go = useNavigate();
      return (
        <>
          <p data-testid="entry-state">{JSON.stringify(location.state)}</p>
          <button type="button" onClick={() => go(-1)}>Back</button>
          <button type="button" onClick={() => go(1)}>Forward</button>
        </>
      );
    };
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter
          initialEntries={['/t/devices/d-9', { pathname: '/t/maintenance', state: { recordId: 'm-7' } }]}
          initialIndex={1}
        >
          <History />
          <Routes>
            <Route path="/t/maintenance" element={<MaintenancePage />} />
            <Route path="/t/devices/:id" element={<p>Device page</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('dialog', { name: 'Maintenance on TL-0009' })).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('entry-state').textContent).toBe('null'));
    // The record stays open after its id leaves the entry.
    expect(screen.getByRole('dialog', { name: 'Maintenance on TL-0009' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText('Device page')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('dialog', { name: 'Maintenance on TL-0009' })).toBeNull();
    expect(fetchMaintenanceRecords).toHaveBeenCalledTimes(1);
  });

  it('opens maintenance preselected from the device detail navigation', async () => {
    openMaintenance.mockResolvedValue({ record: record(), device: { id: 'd-9' } });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter
          initialEntries={[{ pathname: '/t/maintenance', state: { deviceId: 'd-9' } }]}
        >
          <Routes>
            <Route path="/t/maintenance" element={<MaintenancePage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText('Open maintenance for TL-0009')).toBeTruthy();
    fireEvent.change(dialog.getByLabelText(/Description/), { target: { value: 'Antenna loose' } });
    fireEvent.change(dialog.getByLabelText(/Expected completion/), { target: { value: TOMORROW } });
    fireEvent.click(dialog.getByRole('button', { name: 'Open maintenance' }));
    await waitFor(() =>
      expect(openMaintenance).toHaveBeenCalledWith('d-9', {
        reason: 'STAFF_REPORTED',
        description: 'Antenna loose',
        expectedAt: TOMORROW,
        expectedVersion: 5,
      }),
    );
  });

  it('filters the records by status and reason', async () => {
    renderPage();
    await table();
    // Status is the Show filter of the list (chapter 06 §9.3); the reason select stays beside it.
    fireEvent.click(screen.getByRole('button', { name: /^Show: Every status/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Completed' }));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'INSPECTION_FAILED' } });
    await waitFor(() =>
      expect(recordFilters).toContainEqual(
        expect.objectContaining({ status: ['COMPLETED'], reason: ['INSPECTION_FAILED'], pageNumber: 1 }),
      ),
    );
  });

  it('shows the record detail with its checklist results', async () => {
    records = [
      record({
        status: 'COMPLETED',
        resolution: 'Battery replaced',
        actualCostVnd: 500000,
        checklistResults: [{ item: 'Battery health', passed: true, note: 'replaced' }],
      }),
    ];
    renderPage();
    fireEvent.click((await table()).getByRole('button', { name: 'TL-0009' }));
    const drawer = within(screen.getByRole('dialog', { name: 'Maintenance on TL-0009' }));
    expect(drawer.getByText('Six-month service')).toBeTruthy();
    expect(drawer.getByText('Battery replaced')).toBeTruthy();
    expect(drawer.getByText('Battery health: Pass, replaced')).toBeTruthy();
    expect(drawer.getByText('Vendor, Hoang Long Electronics')).toBeTruthy();
    expect(drawer.queryByRole('button', { name: 'Complete' })).toBeNull();
  });

  it('completes an INSPECTION_FAILED record and says the device needs an intake check', async () => {
    records = [record({ reason: 'INSPECTION_FAILED', checklist: [] })];
    completeMaintenance.mockResolvedValue(record({ reason: 'INSPECTION_FAILED', status: 'COMPLETED' }));
    renderPage();
    fireEvent.click((await table()).getByRole('button', { name: /^Complete/ }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText(/Resolution/), { target: { value: 'Antenna reseated' } });
    fireEvent.change(dialog.getByLabelText(/Actual cost/), { target: { value: '0' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(completeMaintenance).toHaveBeenCalledWith('d-9', 'm-1', {
        status: 'COMPLETED',
        resolution: 'Antenna reseated',
        actualCostVnd: 0,
        expectedVersion: 1,
      }),
    );
    expect(await screen.findByText(/TL-0009 stays in maintenance until it passes an intake check/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open TL-0009' }).getAttribute('href')).toBe('/t/devices/d-9');
  });

  it('asks before marking a record unrepairable', async () => {
    completeMaintenance.mockResolvedValue(record({ status: 'UNREPAIRABLE' }));
    renderPage();
    fireEvent.click((await table()).getByRole('button', { name: /^Complete/ }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.click(dialog.getByLabelText('Unrepairable'));
    fireEvent.change(dialog.getByLabelText(/Resolution/), { target: { value: 'Board cracked' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Save' }));
    const confirm = within(await screen.findByRole('dialog', { name: 'Mark TL-0009 unrepairable?' }));
    expect(confirm.getByText('The device stays in maintenance until an Admin retires it.')).toBeTruthy();
    expect(completeMaintenance).not.toHaveBeenCalled();
    fireEvent.click(confirm.getByRole('button', { name: 'Mark unrepairable' }));
    await waitFor(() =>
      expect(completeMaintenance).toHaveBeenCalledWith('d-9', 'm-1', {
        status: 'UNREPAIRABLE',
        resolution: 'Board cracked',
        expectedVersion: 1,
      }),
    );
  });

  it('shows MSG36 with Reload on STALE_VERSION, and Reload closes the dialog', async () => {
    estimateMaintenance.mockRejectedValueOnce(new ApiError(409, 'STALE_VERSION', 'stale'));
    renderPage();
    fireEvent.click((await table()).getByRole('button', { name: /^Estimate/ }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText(/Estimated cost/), { target: { value: '700000' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Save estimate' }));
    expect(await dialog.findByText('Someone else changed this. Reload to see the latest.')).toBeTruthy();
    expect((dialog.getByLabelText(/Estimated cost/) as HTMLInputElement).value).toBe('700.000');
    fireEvent.click(dialog.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it("lists the week's service and the units due but still out", async () => {
    devicesOut = [
      { id: 'd-5', assetTag: 'TL-0005', status: 'RENTED', serviceDueAt: '2000-01-01' },
      { id: 'd-6', assetTag: 'TL-0006', status: 'RENTED', serviceDueAt: '2999-01-01' },
    ];
    renderPage();
    await table();
    fireEvent.click(screen.getByRole('tab', { name: /This week's service/ }));
    expect(await screen.findByText('Nothing is due this week.')).toBeTruthy();
    expect(screen.getByText('Due but still out')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'TL-0005' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'TL-0006' })).toBeNull();
    expect(recordFilters).toContainEqual(
      expect.objectContaining({ status: ['OPEN'], reason: ['SCHEDULED', 'FIRMWARE_UPDATE'] }),
    );
  });

  it('opens maintenance on a chosen available device from the page button', async () => {
    renderPage();
    await table();
    fireEvent.click(screen.getByRole('button', { name: 'Open maintenance' }));
    const picker = within(screen.getByRole('dialog', { name: 'Open maintenance' }));
    fireEvent.click(picker.getByRole('button', { name: 'Continue' }));
    expect(picker.getByText('Choose a device.')).toBeTruthy();
    fireEvent.change(picker.getByLabelText(/Device/), { target: { value: 'd-9' } });
    fireEvent.click(picker.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('dialog', { name: 'Open maintenance for TL-0009' })).toBeTruthy();
  });

  it("pages the week's service and the approvals instead of hiding past the first 20", async () => {
    currentRoles = ['ADMIN'];
    currentUserId = 'admin-2';
    approvals = [record({ id: 'm-2', status: 'PENDING_APPROVAL' })];
    weekRecords = [record({ id: 'm-3' })];
    pages = 2;
    renderPage();
    await table();
    fireEvent.click(screen.getByRole('tab', { name: /This week's service/ }));
    fireEvent.click(within(screen.getByRole('tabpanel', { name: /This week's service/ })).getByRole('button', { name: 'Next page' }));
    await waitFor(() =>
      expect(recordFilters).toContainEqual(expect.objectContaining({ dueBefore: expect.any(String), pageNumber: 2 })),
    );
    fireEvent.click(screen.getByRole('tab', { name: /Approvals/ }));
    fireEvent.click(within(screen.getByRole('tabpanel', { name: /Approvals/ })).getByRole('button', { name: 'Next page' }));
    await waitFor(() =>
      expect(recordFilters).toContainEqual(expect.objectContaining({ status: ['PENDING_APPROVAL'], pageNumber: 2 })),
    );
  });

  // W26: the device, status and expected headers sort on the server (devices api-design 15).
  it('sends the header sort to the record query from page 1, each list on its own', async () => {
    pages = 2;
    renderPage();
    const records = await table();
    const allRecords = () =>
      recordFilters.filter((filters) => !filters.dueBefore && !filters.status?.includes('PENDING_APPROVAL'));
    fireEvent.click(
      within(screen.getByRole('tabpanel', { name: /Records/ })).getByRole('button', { name: 'Next page' }),
    );
    await waitFor(() => expect(allRecords().at(-1)).toMatchObject({ pageNumber: 2 }));
    fireEvent.click(records.getByRole('button', { name: 'Record' }));
    await waitFor(() => expect(allRecords().at(-1)).toMatchObject({ pageNumber: 1, sort: 'assetTag', order: 'asc' }));
    // The expected date is the default order: it toggles, and soonest first sends no sort.
    fireEvent.click(records.getByRole('button', { name: 'Expected' }));
    await waitFor(() => expect(allRecords().at(-1)).toMatchObject({ sort: 'expectedAt', order: 'desc' }));
    fireEvent.click(records.getByRole('button', { name: 'Expected' }));
    await waitFor(() => expect(allRecords().at(-1)).not.toHaveProperty('sort'));
    const sortable = records
      .getAllByRole('columnheader')
      .filter((cell) => cell.querySelector('[data-sort-icon]'))
      .map((cell) => cell.textContent);
    expect(sortable).toEqual(['Record', 'Status', 'Expected']);
    // The week's list keeps its default order.
    expect(recordFilters.filter((filters) => filters.dueBefore).at(-1)).not.toHaveProperty('sort');
  });

  it('keeps the pager when the list shrinks below the page the user is on', async () => {
    weekRecords = [record({ id: 'm-3' })];
    pages = 2;
    renderPage();
    await table();
    fireEvent.click(screen.getByRole('tab', { name: /This week's service/ }));
    const panel = () => within(screen.getByRole('tabpanel', { name: /This week's service/ }));
    pages = 1; // the row on page 2 was completed; the list now has one page
    fireEvent.click(panel().getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(panel().getByRole('button', { name: 'Previous page' })).toBeTruthy());
  });

  it('searches the available devices in the picker and names the 100-device cap', async () => {
    pages = 6;
    renderPage();
    await table();
    fireEvent.click(screen.getByRole('button', { name: 'Open maintenance' }));
    const picker = within(screen.getByRole('dialog', { name: 'Open maintenance' }));
    expect(picker.getByText('Showing the first 100 of 120; search to narrow.')).toBeTruthy();
    fireEvent.change(picker.getByLabelText(/Search/), { target: { value: 'TL-0009' } });
    await waitFor(() =>
      expect(deviceFilters).toContainEqual(expect.objectContaining({ status: ['AVAILABLE'], q: 'TL-0009' })),
    );
  });

  it('names the approval threshold amount beside the estimate', async () => {
    renderPage();
    fireEvent.click((await table()).getByRole('button', { name: /^Estimate/ }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText(/Above 1[.,]000[.,]000.*an Admin must approve before completion\./)).toBeTruthy();
  });

  it('names the rule without an amount when the threshold is not known', async () => {
    thresholdVnd = undefined;
    renderPage();
    fireEvent.click((await table()).getByRole('button', { name: /^Estimate/ }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('VND. Above the approval threshold, an Admin must approve before completion.')).toBeTruthy();
  });
});

describe('MaintenanceApprovalPage bulk decisions (W29)', () => {
  afterEach(cleanup);

  const openApprovals = async () => {
    await screen.findByRole('tab', { name: /Approvals/ });
    fireEvent.click(screen.getByRole('tab', { name: /Approvals/ }));
    return within(await screen.findByRole('table', { name: 'Costs waiting for a decision' }));
  };

  it('approves the selected costs in sequence at their amount and version, never one the viewer estimated', async () => {
    currentRoles = ['ADMIN'];
    currentUserId = 'admin-2';
    records = [];
    approvals = [
      record({ id: 'm-1', device: { id: 'd-1', assetTag: 'TL-0001' }, status: 'PENDING_APPROVAL', version: 2 }),
      record({ id: 'm-2', device: { id: 'd-2', assetTag: 'TL-0002' }, status: 'PENDING_APPROVAL', estimatedById: 'admin-2' }),
      record({ id: 'm-3', device: { id: 'd-3', assetTag: 'TL-0003' }, status: 'PENDING_APPROVAL', actualCostVnd: 1_900_000, version: 4 }),
    ];
    decideMaintenance.mockReset();
    decideMaintenance
      .mockResolvedValueOnce(record({ status: 'OPEN' }))
      .mockRejectedValueOnce(new ApiError(409, 'STALE_VERSION', 'This was changed by someone else. Reload and try again.'));
    renderPage();
    const table = await openApprovals();
    fireEvent.click(table.getByLabelText('Select TL-0001'));
    fireEvent.click(table.getByLabelText('Select TL-0002'));
    fireEvent.click(table.getByLabelText('Select TL-0003'));
    fireEvent.click(screen.getByRole('button', { name: 'Approve 2 costs' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Approve 2 costs?' })).getByRole('button', { name: 'Approve 2 costs' }));
    const summary = await screen.findByRole('dialog', { name: '1 of 2 done' });
    expect(within(summary).getByText(/TL-0003/).closest('li')?.textContent).toContain('Reload and try again');
    expect(decideMaintenance.mock.calls).toEqual([
      ['d-1', 'm-1', { decision: 'APPROVED', approvedCostVnd: 650000, expectedVersion: 2 }],
      ['d-3', 'm-3', { decision: 'APPROVED', approvedCostVnd: 1_900_000, expectedVersion: 4 }],
    ]);
  });

  it('asks for one reason before rejecting in bulk, in an alert dialog with the count', async () => {
    currentRoles = ['ADMIN'];
    currentUserId = 'admin-2';
    records = [];
    approvals = [record({ id: 'm-1', status: 'PENDING_APPROVAL' })];
    decideMaintenance.mockReset();
    decideMaintenance.mockResolvedValue(record({ status: 'OPEN' }));
    renderPage();
    const table = await openApprovals();
    fireEvent.click(table.getByLabelText('Select TL-0009'));
    fireEvent.click(screen.getByRole('button', { name: 'Reject 1 cost' }));
    const confirm = within(screen.getByRole('alertdialog', { name: 'Reject 1 cost?' }));
    fireEvent.click(confirm.getByRole('button', { name: 'Reject 1 cost' }));
    expect(await confirm.findByText('Enter a reason for this change.')).toBeTruthy();
    fireEvent.change(confirm.getByLabelText(/Reason/), { target: { value: 'Quote too high' } });
    fireEvent.click(confirm.getByRole('button', { name: 'Reject 1 cost' }));
    await waitFor(() =>
      expect(decideMaintenance).toHaveBeenCalledWith('d-9', 'm-1', { decision: 'REJECTED', reason: 'Quote too high', expectedVersion: 1 }),
    );
  });
});
