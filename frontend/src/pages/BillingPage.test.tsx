// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Payment } from '../entities/billing/api';
import { BillingPage } from './BillingPage';

const payment = (id: string, reference: string, method: Payment['method']): Payment => ({
  id,
  reference,
  invoiceId: 'i-1',
  contractId: 'c-1',
  amountVnd: 1_000_000,
  method,
  status: 'CONFIRMED',
  isSandbox: method === 'SEPAY',
  expiresAt: null,
  confirmedAt: '2026-11-02T03:15:00Z',
});

const paymentFilters: unknown[] = [];
vi.mock('../entities/billing/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../entities/billing/api')>()),
  useInvoices: () => ({ isLoading: false, data: { items: [], pageNumber: 1, pageSize: 20, totalCount: 0, totalPages: 0 } }),
  usePayments: (filters: unknown) => {
    paymentFilters.push(filters);
    const items = [payment('p-1', 'TL7K2Q9M4D', 'SEPAY'), payment('p-2', 'CASH-0001', 'CASH'), payment('p-3', 'CASH-0002', 'CASH')];
    return { isLoading: false, data: { items, pageNumber: 1, pageSize: 20, totalCount: 3, totalPages: 1 } };
  },
}));

afterEach(cleanup);

describe('BillingPage, payments (billing api-design 14)', () => {
  it('narrows the payments by method from Show, combined with the server status (review of treklink-web#350)', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <BillingPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Payments' }));
    const table = () => within(screen.getByRole('table', { name: 'Payments' }));
    expect(table().getAllByRole('row')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: /^Show: Every status/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Confirmed' }));
    fireEvent.click(screen.getByRole('button', { name: /^Show: Confirmed/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Method: Cash' }));
    expect(table().getAllByRole('row')).toHaveLength(3);
    expect(table().queryByText('TL7K2Q9M4D')).toBeNull();
    expect(paymentFilters.at(-1)).toEqual({ status: 'CONFIRMED', pageNumber: 1 });
  });
});
