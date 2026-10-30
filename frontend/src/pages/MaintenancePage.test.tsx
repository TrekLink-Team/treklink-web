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

const page = (items: unknown[]) => ({
  items,
  pageNumber: 1,
  pageSize: 20,
  totalCount: items.length,
  totalPages: items.length > 0 ? 1 : 0,
});

let records: unknown[] = [record()];
let approvals: unknown[] = [];

vi.mock('../entities/device/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../entities/device/api')>()),
  useDevice: () => ({ data: { id: 'd-9', assetTag: 'TL-0009', version: 5 } }),
  useMaintenanceRecords: (filters: { status?: string[]; dueBefore?: string }, enabled = true) => {
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
});
afterEach(cleanup);

describe('MaintenancePage (/t/maintenance, screen 4.3)', () => {
  it('lists records with their reason, status and cost', async () => {
    renderPage();
    expect(await screen.findByText('TL-0009')).toBeTruthy();
    expect(screen.getByText('SCHEDULED')).toBeTruthy();
    expect(screen.getByText('OPEN')).toBeTruthy();
  });

  it('hides the approvals tab for Staff, and MSG26 on the approvals route', async () => {
    renderPage();
    await screen.findByText('TL-0009');
    expect(screen.queryByRole('tab', { name: /Approvals/ })).toBeNull();
    renderPage('/t/maintenance/approvals');
    expect(await screen.findByText(/do not have access/i)).toBeTruthy();
  });

  it('estimates an OPEN record, sending the amount and work-by', async () => {
    estimateMaintenance.mockResolvedValue(record({ status: 'OPEN' }));
    renderPage();
    await screen.findByText('TL-0009');
    fireEvent.click(screen.getByRole('button', { name: 'Estimate' }));
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
    await screen.findByText('TL-0009');
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }));
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
    await screen.findByText('TL-0009');
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }));
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
    expect(await screen.findByText('A different Admin must decide this.')).toBeTruthy();
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
    fireEvent.click(await screen.findByRole('button', { name: 'Decide' }));
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
    fireEvent.click(await screen.findByRole('button', { name: 'Decide' }));
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
});
