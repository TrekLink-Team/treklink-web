// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContractsPage } from './ContractsPage';

const cancelContract = vi.fn();
let roles = ['ORG_MANAGER'];

const contract = (overrides: Record<string, unknown>) => ({
  id: 'c-1',
  code: 'RC-2026-0001',
  planType: 'MONTHLY',
  dayPlanDays: null,
  hardwareVariant: { id: 'v-3', code: 'treklink-v3' },
  quantity: 5,
  requestedStartDate: '2026-11-10',
  status: 'REQUESTED',
  version: 2,
  terms: [],
  ...overrides,
});

const items = [
  contract({}),
  contract({ id: 'c-2', code: 'RC-2026-0002', status: 'APPROVED', version: 4 }),
  contract({ id: 'c-3', code: 'RC-2026-0003', status: 'ACTIVE' }),
];

vi.mock('../app/providers/useAuth', () => ({ useAuth: () => ({ user: { roles } }) }));
vi.mock('../entities/contract/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../entities/contract/api')>()),
  useContracts: () => ({
    isLoading: false,
    data: { items, pageNumber: 1, pageSize: 20, totalCount: items.length, totalPages: 1 },
  }),
  cancelContract: (...args: unknown[]) => cancelContract(...args),
}));

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ContractsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

afterEach(() => {
  cleanup();
  roles = ['ORG_MANAGER'];
  cancelContract.mockReset();
});

const table = () => within(screen.getByRole('table', { name: 'Contracts' }));

describe('ContractsPage (/o/contracts, screen 5.2)', () => {
  it('links each row to its contract and offers the Manager Cancel before handover only', () => {
    renderPage();
    expect(table().getByRole('link', { name: 'RC-2026-0001' }).getAttribute('href')).toBe('/o/contracts/c-1');
    expect(table().getByRole('button', { name: /^Cancel contract\s+RC-2026-0001/ })).toBeTruthy();
    expect(table().getByRole('button', { name: /^Cancel contract\s+RC-2026-0002/ })).toBeTruthy();
    expect(table().queryByRole('button', { name: /^Cancel contract\s+RC-2026-0003/ })).toBeNull();
  });

  it('gives an Org Operator no row action', () => {
    roles = ['ORG_OPERATOR'];
    renderPage();
    expect(table().queryByRole('button', { name: /^Cancel contract/ })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Request a contract' })).toBeNull();
  });

  it('cancels with the reason and the loaded version', async () => {
    cancelContract.mockResolvedValue({});
    renderPage();
    fireEvent.click(table().getByRole('button', { name: /^Cancel contract\s+RC-2026-0002/ }));
    const dialog = within(screen.getByRole('alertdialog', { name: 'Cancel contract RC-2026-0002?' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel contract' }));
    expect(await dialog.findByText('Enter a reason for this change.')).toBeTruthy();
    fireEvent.change(dialog.getByLabelText(/Reason/), { target: { value: 'Our tour was cancelled.' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel contract' }));
    await waitFor(() => expect(cancelContract).toHaveBeenCalledWith('c-2', 'Our tour was cancelled.', 4));
  });
});
