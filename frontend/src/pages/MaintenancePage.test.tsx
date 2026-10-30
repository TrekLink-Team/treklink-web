// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../shared/api/apiClient';
import { MaintenanceApprovalPage, MaintenancePage } from './MaintenancePage';

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

const page = (items: unknown[]) => ({
  approvalThresholdVnd: thresholdVnd,
  items,
  pageNumber: 1,
  pageSize: 20,
  totalCount: items.length,
  totalPages: items.length > 0 ? 1 : 0,
});

let records: unknown[] = [record()];
let approvals: unknown[] = [];
let devicesOut: unknown[] = [];
const recordFilters: { status?: string[]; reason?: string[]; dueBefore?: string }[] = [];

vi.mock('../entities/device/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../entities/device/api')>()),
  useDevice: () => ({ data: { id: 'd-9', assetTag: 'TL-0009', version: 5 } }),
  useDevices: (filters: { status?: string[] }) => ({
    data: page(
      filters.status?.includes('AVAILABLE')
        ? [{ id: 'd-9', assetTag: 'TL-0009', status: 'AVAILABLE' }]
        : devicesOut,
    ),
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useMaintenanceRecords: (filters: { status?: string[]; dueBefore?: string }, enabled = true) => {
    recordFilters.push(filters);
    if (!enabled) return { data: page([]), isLoading: false, error: null, refetch: vi.fn() };
    const items = filters.status?.includes('PENDING_APPROVAL')
      ? approvals
      : filters.dueBefore
        ? [] // the week's list is exercised separately; kept empty to avoid ambiguous matches
        : records;
    return { data: page(items), isLoading: false, error: null, refetch: vi.fn() };
  },
  estimateMaintenance: (...args: unknown[]) => estimateMaintenance(...args),
  completeMaintenance: (...args: unknown[]) => completeMaintenance(...args),
  decideMaintenance: (...args: unknown[]) => decideMaintenance(...args),
  openMaintenance: (...args: unknown[]) => openMaintenance(...args),
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
  estimateMaintenance.mockReset();
  completeMaintenance.mockReset();
  decideMaintenance.mockReset();
  openMaintenance.mockReset();
  currentRoles = ['STAFF'];
  currentUserId = 'staff-1';
  records = [record()];
  approvals = [];
  devicesOut = [];
  thresholdVnd = 1_000_000;
  recordFilters.length = 0;
});

const table = async () => within(await screen.findByRole('table', { name: 'Maintenance records' }));
afterEach(cleanup);

describe('MaintenancePage (/t/maintenance, screen 4.3)', () => {
  it('lists records with their reason, status and cost', async () => {
    renderPage();
    const rows = await table();
    expect(rows.getByText('TL-0009')).toBeTruthy();
    expect(rows.getByText('Scheduled service')).toBeTruthy();
    expect(rows.getByText('Open')).toBeTruthy();
    expect(rows.getByText(/650,000|650\.000/)).toBeTruthy();
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
    fireEvent.click((await table()).getByRole('button', { name: 'Estimate' }));
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
    fireEvent.click((await table()).getByRole('button', { name: 'Complete' }));
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
    fireEvent.click((await table()).getByRole('button', { name: 'Complete' }));
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
    expect((await screen.findAllByText('A different Admin must decide this.')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Decide' })).toBeNull();
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
        name: 'Decide',
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
        name: 'Decide',
      }),
    );
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText(/Approved amount/), { target: { value: '600000' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Save decision' }));
    expect(await screen.findByText('A different Admin must approve this cost.')).toBeTruthy();
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
    fireEvent.change(dialog.getByLabelText(/Expected completion/), { target: { value: '2026-11-05' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Open maintenance' }));
    await waitFor(() =>
      expect(openMaintenance).toHaveBeenCalledWith('d-9', {
        reason: 'STAFF_REPORTED',
        description: 'Antenna loose',
        expectedAt: '2026-11-05',
        expectedVersion: 5,
      }),
    );
  });

  it('filters the records by status and reason', async () => {
    renderPage();
    await table();
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'COMPLETED' } });
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
    fireEvent.click((await table()).getByRole('button', { name: 'Complete' }));
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
    fireEvent.click((await table()).getByRole('button', { name: 'Complete' }));
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
    fireEvent.click((await table()).getByRole('button', { name: 'Estimate' }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText(/Estimated cost/), { target: { value: '700000' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Save estimate' }));
    expect(await dialog.findByText('Someone else changed this. Reload to see the latest.')).toBeTruthy();
    expect((dialog.getByLabelText(/Estimated cost/) as HTMLInputElement).value).toBe('700000');
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

  it('names the approval threshold amount beside the estimate', async () => {
    renderPage();
    fireEvent.click((await table()).getByRole('button', { name: 'Estimate' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText(/Above 1[.,]000[.,]000.*an Admin must approve before completion\./)).toBeTruthy();
  });

  it('names the rule without an amount when the threshold is not known', async () => {
    thresholdVnd = undefined;
    renderPage();
    fireEvent.click((await table()).getByRole('button', { name: 'Estimate' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('VND. Above the approval threshold, an Admin must approve before completion.')).toBeTruthy();
  });
});
