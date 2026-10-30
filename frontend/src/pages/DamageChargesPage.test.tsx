// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DamageChargesPage } from './DamageChargesPage';

let roles = ['ADMIN'];
let charges: object[] = [];
const filtersSeen: object[] = [];
const decideDamageCharge = vi.fn();

vi.mock('../app/providers/useAuth', () => ({
  useAuth: () => ({ user: { id: 'admin-1', roles } }),
}));

vi.mock('../entities/billing/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../entities/billing/api')>()),
  useDamageCharges: (filters: object) => {
    filtersSeen.push(filters);
    return {
      data: {
        items: charges,
        pageNumber: 1,
        pageSize: 20,
        totalCount: charges.length,
        totalPages: 1,
      },
      isLoading: false,
      error: null,
    };
  },
  decideDamageCharge: (...args: unknown[]) => decideDamageCharge(...args),
}));

const charge = (id: string, inspectorId: string, overrides: object = {}) => ({
  id,
  contractId: 'c-1',
  deviceId: `d-${id}`,
  assetTag: id === 'dc-1' ? 'TL-0001' : 'TL-0002',
  inspectionId: `i-${id}`,
  inspector: { id: inspectorId, fullName: inspectorId === 'admin-1' ? 'Demo Admin' : 'Demo Staff' },
  damageCodes: ['CASING_CRACKED'],
  amountVnd: 700_000,
  finalVnd: null,
  status: 'PENDING_APPROVAL',
  decisionNote: null,
  decidedAt: null,
  createdAt: '2026-10-30T03:00:00Z',
  ...overrides,
});

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <DamageChargesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const rowOf = (tag: string) => screen.getByText(tag).closest('tr') as HTMLElement;

afterEach(() => {
  cleanup();
  roles = ['ADMIN'];
  charges = [];
  filtersSeen.length = 0;
  decideDamageCharge.mockReset();
});

describe('DamageChargesPage (screen 6.4, UC-48)', () => {
  it('opens on the approval queue and hides Decide on a charge the Admin inspected (BR-24)', () => {
    charges = [charge('dc-1', 'staff-1'), charge('dc-2', 'admin-1')];
    renderPage();
    expect(filtersSeen).toContainEqual({ status: 'PENDING_APPROVAL', pageNumber: 1 });
    expect(within(rowOf('TL-0001')).getByRole('button', { name: 'Decide' })).toBeTruthy();
    expect(within(rowOf('TL-0002')).queryByRole('button', { name: 'Decide' })).toBeNull();
    expect(within(rowOf('TL-0002')).getByText('Another Admin must decide')).toBeTruthy();
  });

  it('shows Staff the queue read-only', () => {
    roles = ['STAFF'];
    charges = [charge('dc-1', 'staff-9')];
    renderPage();
    expect(screen.queryByRole('button', { name: 'Decide' })).toBeNull();
    expect(screen.getByText(/Only a TrekLink Admin who did not inspect/)).toBeTruthy();
  });

  it('records a reduction below the amount, with its reason', async () => {
    charges = [charge('dc-1', 'staff-1')];
    decideDamageCharge.mockResolvedValue({ id: 'dc-1', status: 'REDUCED' });
    renderPage();
    fireEvent.click(within(rowOf('TL-0001')).getByRole('button', { name: 'Decide' }));
    fireEvent.click(screen.getByLabelText('Reduce'));
    fireEvent.change(screen.getByLabelText(/Final amount/), { target: { value: '700000' } });
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Old crack' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record decision' }));
    expect(screen.getByText(/Final amount must be a whole number of VND below/)).toBeTruthy();
    expect(decideDamageCharge).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Final amount/), { target: { value: '400,000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record decision' }));
    await waitFor(() =>
      expect(decideDamageCharge).toHaveBeenCalledWith('dc-1', {
        decision: 'REDUCED',
        finalVnd: 400_000,
        note: 'Old crack',
      }),
    );
  });

  it('asks before waiving, naming the amount and the device', async () => {
    charges = [charge('dc-1', 'staff-1')];
    decideDamageCharge.mockResolvedValue({ id: 'dc-1', status: 'WAIVED' });
    renderPage();
    fireEvent.click(within(rowOf('TL-0001')).getByRole('button', { name: 'Decide' }));
    fireEvent.click(screen.getByLabelText('Waive'));
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Goodwill' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record decision' }));
    expect(screen.getByText('Waive the 700,000 VND charge on TL-0001?')).toBeTruthy();
    expect(decideDamageCharge).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Waive' }));
    await waitFor(() =>
      expect(decideDamageCharge).toHaveBeenCalledWith('dc-1', {
        decision: 'WAIVED',
        note: 'Goodwill',
      }),
    );
  });

  it('says when nothing waits for a decision', () => {
    renderPage();
    expect(screen.getByText('No damage charges are waiting for a decision.')).toBeTruthy();
  });
});
