// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../shared/api/apiClient';
import { useToast } from '../shared/ui/toastStore';
import { ContractApprovalPage } from './ContractApprovalPage';

const approveContract = vi.fn();

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
  useContracts: () => ({
    isLoading: false,
    data: { items: [requested], pageNumber: 1, pageSize: 20, totalCount: 1, totalPages: 1 },
  }),
  useAvailability: () => ({
    isLoading: false,
    data: [{ hardwareVariantId: 'v-3', code: 'treklink-v3', available: 10 }],
  }),
  approveContract: (...args: unknown[]) => approveContract(...args),
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
    approveContract.mockReset();
  });

  it('names the variant by its display name in the queue and the request panel', async () => {
    renderPage();
    expect((await screen.findAllByText('TrekLink v3 x 5')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole('button', { name: /RC-2026-0004/ })[0]);
    const panel = screen.getByRole('complementary');
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
      fireEvent.click((await screen.findAllByRole('button', { name: /RC-2026-0004/ }))[0]);
      const panel = screen.getByRole('complementary');
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

  it('shows a refused appointment in the past under the field, and clears it on a new time', async () => {
    const message = 'The handover appointment is in the past. Choose a time from now on.';
    approveContract.mockRejectedValue(new ApiError(400, 'VALIDATION_FAILED', message));
    renderPage();
    fireEvent.click(screen.getAllByRole('button', { name: /RC-2026-0004/ })[0]);
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
    fireEvent.click(screen.getAllByRole('button', { name: /RC-2026-0004/ })[0]);
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
    fireEvent.click(screen.getAllByRole('button', { name: /RC-2026-0004/ })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(
      await screen.findByText('Reserved: TL-0003, TL-0004, TL-0005, TL-0006, TL-0011'),
    ).toBeTruthy();
    expect(useToast.getState().message).toBe('RC-2026-0004 approved. 5 devices reserved.');
  });
});
