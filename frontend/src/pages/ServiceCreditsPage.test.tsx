// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../shared/api/apiClient';
import { ServiceCreditsPage } from './ServiceCreditsPage';

let roles = ['ADMIN'];
let credits: object[] = [];
const filtersSeen: object[] = [];
const decideServiceCredit = vi.fn();
const recordServiceCreditRefund = vi.fn();

vi.mock('../app/providers/useAuth', () => ({
  useAuth: () => ({ user: { id: 'admin-1', roles } }),
}));

vi.mock('../entities/billing/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../entities/billing/api')>()),
  useServiceCredits: (filters: object) => {
    filtersSeen.push(filters);
    return {
      data: {
        items: credits,
        pageNumber: 1,
        pageSize: 20,
        totalCount: credits.length,
        totalPages: 1,
      },
      isLoading: false,
      error: null,
    };
  },
  decideServiceCredit: (...args: unknown[]) => decideServiceCredit(...args),
  recordServiceCreditRefund: (...args: unknown[]) => recordServiceCreditRefund(...args),
}));

const credit = (id: string, requestedById: string, overrides: object = {}) => ({
  id,
  contractId: 'c-1',
  contractDeviceId: `cd-${id}`,
  deviceId: `d-${id}`,
  assetTag: id === 'sc-1' ? 'TL-0001' : 'TL-0002',
  cause: 'BATTERY_FAULT',
  faultInspectionId: `in-${id}`,
  outageFrom: '2026-11-12T02:00:00Z',
  outageSourceIncidentId: null,
  outageSourceNote: 'Called the counter at 09:00',
  outageTo: '2026-11-15T02:00:00Z',
  outageDays: 3,
  computedVnd: 45_000,
  decidedVnd: null,
  appliedVnd: 0,
  status: 'REQUESTED',
  requestedById,
  decisionReason: null,
  decidedAt: null,
  refundReference: null,
  refundedAt: null,
  version: 1,
  createdAt: '2026-11-15T03:00:00Z',
  ...overrides,
});

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ServiceCreditsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const rowOf = (tag: string) => screen.getByText(tag).closest('tr') as HTMLElement;

afterEach(() => {
  cleanup();
  roles = ['ADMIN'];
  credits = [];
  filtersSeen.length = 0;
  decideServiceCredit.mockReset();
  recordServiceCreditRefund.mockReset();
});

describe('ServiceCreditsPage (screen 6.5, billing design §9.6)', () => {
  it('opens on all statuses and disables Decide on a credit the Admin requested (BR-24)', () => {
    credits = [credit('sc-1', 'staff-1'), credit('sc-2', 'admin-1')];
    renderPage();
    expect(filtersSeen).toContainEqual({ status: undefined, pageNumber: 1 });
    expect(screen.getByRole('button', { name: /^Show: All statuses/ })).toBeTruthy();
    expect(
      within(rowOf('TL-0001'))
        .getByRole('button', { name: /^Decide/ })
        .getAttribute('aria-disabled'),
    ).toBeNull();
    const own = within(rowOf('TL-0002')).getByRole('button', { name: /^Decide/ });
    expect(own.getAttribute('aria-disabled')).toBe('true');
    expect(
      within(rowOf('TL-0002')).getByText('Another Admin must decide: you requested this credit.'),
    ).toBeTruthy();
  });

  it('gives Staff no decision', () => {
    roles = ['STAFF'];
    credits = [credit('sc-1', 'staff-1')];
    renderPage();
    expect(screen.queryByRole('button', { name: /^Decide/ })).toBeNull();
    expect(screen.getByText(/Only a TrekLink Admin who did not request a credit/)).toBeTruthy();
  });

  it('reduces below the computed credit with a reason and the version seen', async () => {
    credits = [credit('sc-1', 'staff-1')];
    decideServiceCredit.mockResolvedValue({ id: 'sc-1', status: 'APPROVED' });
    renderPage();
    fireEvent.click(within(rowOf('TL-0001')).getByRole('button', { name: /^Decide/ }));
    expect(screen.getByText(/Called the counter at 09:00/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Reduce'));
    fireEvent.change(screen.getByLabelText(/Credit \(VND\)/), { target: { value: '45000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record decision' }));
    expect(screen.getByText(/Credit must be a whole number of VND below/)).toBeTruthy();
    expect(screen.getByText('Reason is required to reduce or reject.')).toBeTruthy();
    expect(decideServiceCredit).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Credit \(VND\)/), { target: { value: '30,000' } });
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Used part of day 10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record decision' }));
    await waitFor(() =>
      expect(decideServiceCredit).toHaveBeenCalledWith('sc-1', {
        decision: 'REDUCE',
        decidedVnd: 30_000,
        reason: 'Used part of day 10',
        expectedVersion: 1,
      }),
    );
  });

  it('asks before rejecting, naming the amount and the device', async () => {
    credits = [credit('sc-1', 'staff-1', { outageSourceNote: null, outageSourceFaultReportId: 'fr-1' })];
    decideServiceCredit.mockResolvedValue({ id: 'sc-1', status: 'REJECTED' });
    renderPage();
    fireEvent.click(within(rowOf('TL-0001')).getByRole('button', { name: /^Decide/ }));
    expect(screen.getByText('Outage start source: a fault report')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Reject'));
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Water damage' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record decision' }));
    expect(screen.getByText('Reject the 45,000 VND credit on TL-0001?')).toBeTruthy();
    expect(decideServiceCredit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    await waitFor(() =>
      expect(decideServiceCredit).toHaveBeenCalledWith('sc-1', {
        decision: 'REJECT',
        reason: 'Water damage',
        expectedVersion: 1,
      }),
    );
  });

  it('records a refund and shows a reference already used under the field', async () => {
    roles = ['STAFF'];
    credits = [credit('sc-1', 'staff-1', { status: 'REFUND_DUE', decidedVnd: 45_000 })];
    recordServiceCreditRefund.mockRejectedValueOnce(
      new ApiError(409, 'DUPLICATE_REFERENCE', 'This reference is already recorded.'),
    );
    renderPage();
    fireEvent.click(within(rowOf('TL-0001')).getByRole('button', { name: /^Record refund/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save refund' }));
    expect(screen.getByText('Reference is required.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Reference/), { target: { value: 'FT2611020001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save refund' }));
    await waitFor(() =>
      expect(screen.getByText('This reference is already recorded.')).toBeTruthy(),
    );
    expect(recordServiceCreditRefund).toHaveBeenCalledWith('sc-1', 'FT2611020001');
  });

  it('says when no service credit is recorded', () => {
    renderPage();
    expect(screen.getByText('No service credits recorded.')).toBeTruthy();
  });
});
