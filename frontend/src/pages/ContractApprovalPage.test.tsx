// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../shared/api/apiClient';
import { useToast } from '../shared/ui/toastStore';
import { ContractApprovalPage } from './ContractApprovalPage';

const approveContract = vi.fn();
const cancelContract = vi.fn();
const rejectContract = vi.fn();
let queue: unknown[] | null = null;
// The filters of every list read, newest last (rentals api-design 02).
const listReads: Record<string, unknown>[] = [];
let totalPages = 1;

const requested = {
  id: 'c-1',
  code: 'RC-2026-0004',
  organization: { id: 'org-1', code: 'ORG-0001', legalName: 'Acme Trek' },
  planType: 'MONTHLY',
  dayPlanDays: null,
  hardwareVariant: { id: 'v-3', code: 'treklink-v3' },
  quantity: 5,
  requestedStartDate: '2099-01-02',
  monthlyUnitPriceVnd: 450_000,
  dayPremium: null,
  holdingFeeRatio: 0.5,
  status: 'REQUESTED',
  version: 1,
  // Null for a request sent before D-092, which approval reserves; set by a test for a held one.
  holdExpiresAt: null as string | null,
};

vi.mock('../entities/contract/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../entities/contract/api')>()),
  useContracts: (_scope: string, filters: Record<string, unknown>) => {
    listReads.push(filters);
    const pageNumber = (filters.pageNumber as number | undefined) ?? 1;
    return {
      isLoading: false,
      data: { items: queue ?? [requested], pageNumber, pageSize: 20, totalCount: 1, totalPages },
    };
  },
  useAvailability: () => ({
    isLoading: false,
    data: [{ hardwareVariantId: 'v-3', code: 'treklink-v3', available: 10 }],
  }),
  approveContract: (...args: unknown[]) => approveContract(...args),
  cancelContract: (...args: unknown[]) => cancelContract(...args),
  rejectContract: (...args: unknown[]) => rejectContract(...args),
}));

// The public plans read (billing api-design 01) answers the variant names.
vi.mock('../shared/api/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/api/apiClient')>()),
  apiClient: (endpoint: string) =>
    endpoint === '/plans'
      ? Promise.resolve({ variants: [{ id: 'v-3', code: 'treklink-v3', name: 'TrekLink v3' }] })
      : new Promise(() => undefined),
}));

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ContractApprovalPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('ContractApprovalPage', () => {
  afterEach(() => {
    cleanup();
    listReads.length = 0;
    approveContract.mockReset();
  });

  it('searches the whole queue on the server with q once typing pauses, from page 1 (REQ-EVT-26)', () => {
    vi.useFakeTimers();
    totalPages = 3;
    try {
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
      expect(listReads.at(-1)).toMatchObject({ pageNumber: 2 });

      const search = screen.getByRole('searchbox', { name: 'Search by contract or organization' });
      fireEvent.change(search, { target: { value: '  acme' } });
      // Back to page 1 at once; q waits for the pause.
      expect(listReads.at(-1)).toMatchObject({ pageNumber: 1, q: undefined });
      act(() => vi.advanceTimersByTime(299));
      expect(listReads.at(-1)?.q).toBeUndefined();
      act(() => vi.advanceTimersByTime(1));
      expect(listReads.at(-1)).toEqual({ status: undefined, pageNumber: 1, q: 'acme' });

      // Clearing the search reads the whole queue again.
      fireEvent.change(search, { target: { value: '' } });
      act(() => vi.advanceTimersByTime(300));
      expect(listReads.at(-1)).toEqual({ status: undefined, pageNumber: 1, q: undefined });
    } finally {
      totalPages = 1;
      vi.useRealTimers();
    }
  });

  // W26: the headers sort on the server (rentals api-design 02) and return to page 1.
  it('sends the header sort to the queue query from page 1', () => {
    totalPages = 3;
    try {
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
      const table = within(screen.getByRole('table', { name: 'Contracts' }));
      fireEvent.click(table.getByRole('button', { name: 'Start' }));
      expect(listReads.at(-1)).toMatchObject({
        pageNumber: 1,
        sort: 'requestedStartDate',
        order: 'asc',
      });
      fireEvent.click(table.getByRole('button', { name: 'Start' }));
      expect(listReads.at(-1)).toMatchObject({ sort: 'requestedStartDate', order: 'desc' });
      const sortable = table
        .getAllByRole('columnheader')
        .filter((cell) => cell.querySelector('[data-sort-icon]'))
        .map((cell) => cell.textContent);
      expect(sortable).toEqual(['Contract', 'Start', 'Status']);
    } finally {
      totalPages = 1;
    }
  });

  it('names the variant by its display name in the queue and the request panel', async () => {
    renderPage();
    expect((await screen.findAllByText('TrekLink v3 x 5')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Show details of RC-2026-0004' }));
    const panel = screen.getByRole('complementary', { name: 'RC-2026-0004' });
    expect(within(panel).getByText('5 x TrekLink v3')).toBeTruthy();
    expect(
      within(panel).getByText('10 TrekLink v3 available now; approval reserves 5.'),
    ).toBeTruthy();
    expect(within(panel).queryByText(/treklink-v3/)).toBeNull();
  });

  it('says a request sent since D-092 already holds its devices, which approval keeps', async () => {
    requested.holdExpiresAt = '2099-01-01T03:00:00.000Z';
    try {
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Show details of RC-2026-0004' }));
      const panel = screen.getByRole('complementary', { name: 'RC-2026-0004' });
      expect(
        within(panel).getByText(
          /^This request holds its 5 TrekLink v3 devices; approval keeps them\. An unpaid hold ends .*2099/,
        ),
      ).toBeTruthy();
      expect(within(panel).queryByText(/available now/)).toBeNull();
    } finally {
      requested.holdExpiresAt = null;
    }
  });

  it('says when the hold of a request has ended (REQ-ERR-12)', async () => {
    requested.holdExpiresAt = '2020-01-01T03:00:00.000Z';
    try {
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Show details of RC-2026-0004' }));
      const panel = screen.getByRole('complementary', { name: 'RC-2026-0004' });
      expect(within(panel).getByText(/^The hold of this request ended .*2020/)).toBeTruthy();
      expect(within(panel).queryByText(/An unpaid hold ends/)).toBeNull();
    } finally {
      requested.holdExpiresAt = null;
    }
  });

  it('shows a refused appointment in the past under the field, and clears it on a new time', async () => {
    const message = 'The handover appointment is in the past. Choose a time from now on.';
    approveContract.mockRejectedValue(new ApiError(400, 'VALIDATION_FAILED', message));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Show details of RC-2026-0004' }));
    const field = screen.getByLabelText('Handover appointment');
    fireEvent.change(field, { target: { value: '2026-10-30T09:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    const error = await screen.findByText(message);
    expect(error.id).toBe('appointment-error');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.getAttribute('aria-describedby')).toBe('appointment-error');
    expect(approveContract).toHaveBeenCalledWith(
      'c-1',
      new Date('2026-10-30T09:00').toISOString(),
      1,
    );

    fireEvent.change(field, { target: { value: '2099-01-02T10:00' } });
    expect(screen.queryByText(message)).toBeNull();
  });

  it('keeps other refusals in the panel alert', async () => {
    approveContract.mockRejectedValue(
      new ApiError(409, 'INSUFFICIENT_DEVICES', 'Only 4 treklink-v3 devices are available.'),
    );
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Show details of RC-2026-0004' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    const alert = await screen.findByText('Only 4 treklink-v3 devices are available.');
    expect(alert.id).not.toBe('appointment-error');
  });

  it('names the contract and the reserved count in the approval toast', async () => {
    approveContract.mockResolvedValue({
      ...requested,
      status: 'APPROVED',
      version: 2,
      reservationExpiresAt: '2099-01-04T02:00:00Z',
      devices: ['TL-0003', 'TL-0004', 'TL-0005', 'TL-0006', 'TL-0011'].map((assetTag) => ({
        deviceId: `d-${assetTag}`,
        assetTag,
        handedOverAt: null,
        checkedInAt: null,
        lostAt: null,
        holder: null,
      })),
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Show details of RC-2026-0004' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(
      await screen.findByText('Reserved: TL-0003, TL-0004, TL-0005, TL-0006, TL-0011'),
    ).toBeTruthy();
    expect(useToast.getState().message).toBe('RC-2026-0004 approved. 5 devices reserved.');
  });
});

describe('ContractApprovalPage row actions (W29)', () => {
  afterEach(() => {
    cleanup();
    queue = null;
    cancelContract.mockReset();
    rejectContract.mockReset();
  });

  const table = () => within(screen.getByRole('table', { name: 'Contracts' }));
  const movesOf = (code: string, status: string) => {
    fireEvent.click(table().getByRole('button', { name: `${status}, change status of ${code}` }));
    const labels = screen.getAllByRole('menuitem').map((item) => item.textContent);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    return labels;
  };

  it('keeps the decided request in the pane once it leaves the queue (review of treklink-web#350)', async () => {
    approveContract.mockResolvedValue({
      ...requested,
      status: 'APPROVED',
      version: 2,
      reservationExpiresAt: '2099-01-04T02:00:00Z',
      devices: [{ deviceId: 'd-1', assetTag: 'TL-0003', handedOverAt: null, checkedInAt: null, lostAt: null, holder: null }],
    });
    const other = (id: string, code: string) => ({ ...requested, id, code });
    queue = [requested, other('c-2', 'RC-2026-0005'), other('c-3', 'RC-2026-0006')];
    const client = new QueryClient();
    // A new element each time, so the rerender reads the queue again.
    const tree = () => (
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ContractApprovalPage />
        </MemoryRouter>
      </QueryClientProvider>
    );
    const { rerender } = render(tree());
    const pane = () => within(screen.getByRole('complementary', { name: 'RC-2026-0004' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show details of RC-2026-0004' }));
    expect(pane().getByText('Requested')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Reserved: TL-0003')).toBeTruthy();
    // The pane takes the status from the approval result at once (re-check of #350).
    expect(pane().getByText('Approved')).toBeTruthy();
    expect(pane().queryByText('Requested')).toBeNull();
    // The refetched queue no longer holds the approved request.
    queue = [other('c-2', 'RC-2026-0005'), other('c-3', 'RC-2026-0006')];
    rerender(tree());
    expect(screen.queryByRole('button', { name: 'Show details of RC-2026-0004' })).toBeNull();
    expect(screen.getByText('Reserved: TL-0003')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'RC-2026-0004' })).toBeTruthy();
    expect(pane().getByText('Approved')).toBeTruthy();
    queue = null;
  });

  it('shows a rejected request as Rejected in the pane (re-check of treklink-web#350)', async () => {
    rejectContract.mockResolvedValue({ ...requested, status: 'REJECTED', version: 2 });
    const other = (id: string, code: string) => ({ ...requested, id, code });
    queue = [requested, other('c-2', 'RC-2026-0005'), other('c-3', 'RC-2026-0006')];
    renderPage();
    const pane = () => within(screen.getByRole('complementary', { name: 'RC-2026-0004' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show details of RC-2026-0004' }));
    fireEvent.click(pane().getByRole('button', { name: 'Reject' }));
    const dialog = within(await screen.findByRole('dialog', { name: /Reject/ }));
    fireEvent.change(dialog.getByLabelText(/Reason/), { target: { value: 'No stock for the dates' } });
    fireEvent.click(dialog.getByRole('button', { name: /^Reject/ }));
    expect(await screen.findByText('Rejected. The Manager sees the reason.')).toBeTruthy();
    expect(pane().getByText('Rejected')).toBeTruthy();
    expect(pane().queryByText('Requested')).toBeNull();
    queue = null;
  });

  it('offers each status only its moves, in Change status, and the counter as an item action', () => {
    queue = [
      requested,
      { ...requested, id: 'c-2', code: 'RC-2026-0005', status: 'APPROVED' },
      { ...requested, id: 'c-3', code: 'RC-2026-0006', status: 'ACTIVE' },
      { ...requested, id: 'c-4', code: 'RC-2026-0007', status: 'CLOSED' },
    ];
    renderPage();
    expect(movesOf('RC-2026-0004', 'Requested')).toEqual(['Reject contract', 'Cancel contract']);
    expect(movesOf('RC-2026-0005', 'Approved')).toEqual(['Cancel contract']);
    expect(table().queryByRole('button', { name: /change status of RC-2026-0006/ })).toBeNull();
    expect(table().getByRole('button', { name: 'Open counter RC-2026-0005' })).toBeTruthy();
    expect(table().getByRole('button', { name: 'Open counter RC-2026-0006' })).toBeTruthy();
    // Unavailable item actions keep their slots, disabled (chapter 06 §11.4).
    expect(table().queryAllByRole('button', { name: /^Open counter RC-2026-000[47]/ }).filter((button) => button.getAttribute('aria-disabled') !== 'true')).toHaveLength(0);
    expect(table().queryByRole('button', { name: /change status of RC-2026-0007/ })).toBeNull();
    // Status changes stay per row: no selection to change together (review of treklink-web#350).
    expect(screen.queryAllByRole('checkbox', { name: /^Select / })).toHaveLength(0);
  });

  it('cancels from the status menu with the reason and the loaded version', async () => {
    cancelContract.mockResolvedValue({});
    queue = [{ ...requested, id: 'c-2', code: 'RC-2026-0005', status: 'APPROVED', version: 3 }];
    renderPage();
    fireEvent.click(table().getByRole('button', { name: 'Approved, change status of RC-2026-0005' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Cancel contract' }));
    const dialog = within(screen.getByRole('alertdialog', { name: 'Cancel contract RC-2026-0005?' }));
    fireEvent.change(dialog.getByLabelText(/Reason/), { target: { value: 'Tour cancelled' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel contract' }));
    await vi.waitFor(() => expect(cancelContract).toHaveBeenCalledWith('c-2', 'Tour cancelled', 3));
  });

  it('opens on All and keeps Requested as a Show filter', () => {
    renderPage();
    const show = screen.getByRole('button', { name: /^Show: All/ });
    expect(show).toBeTruthy();
    fireEvent.click(show);
    expect(screen.getByRole('menuitem', { name: 'Requested' })).toBeTruthy();
  });
});
