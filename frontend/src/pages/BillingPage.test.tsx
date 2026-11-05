// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Invoice, Payment } from '../entities/billing/api';
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

const invoice: Invoice = {
  id: 'i-1',
  number: 'INV-2026-000004',
  organization: { id: 'o-1', code: 'ORG-0001' },
  contract: { id: 'c-1', code: 'RC-2026-0002' },
  kind: 'CLOSING',
  term: null,
  status: 'PAID',
  totalVnd: 2_900_000,
  paidVnd: 2_900_000,
  issuedAt: '2026-11-04T09:30:00Z',
};

let invoices: Invoice[] = [];
const paymentFilters: unknown[] = [];
const invoiceFilters: unknown[] = [];
vi.mock('../entities/billing/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../entities/billing/api')>()),
  useInvoices: (_scope: string, filters: unknown) => {
    invoiceFilters.push(filters);
    return {
      isLoading: false,
      data: { items: invoices, pageNumber: 1, pageSize: 20, totalCount: invoices.length, totalPages: 1 },
    };
  },
  usePayments: (filters: unknown) => {
    paymentFilters.push(filters);
    const items = [payment('p-1', 'TL7K2Q9M4D', 'SEPAY'), payment('p-2', 'CASH-0001', 'CASH'), payment('p-3', 'CASH-0002', 'CASH')];
    return { isLoading: false, data: { items, pageNumber: 1, pageSize: 20, totalCount: 3, totalPages: 1 } };
  },
}));

vi.mock('../widgets/InvoiceDetail/InvoiceDetailView', () => ({
  InvoiceDetailView: ({ invoiceId }: { invoiceId: string }) => <p>Invoice pane {invoiceId}</p>,
}));

afterEach(() => {
  cleanup();
  invoices = [];
});

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <BillingPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('BillingPage, invoices (screen 6.1)', () => {
  // W15 panel walk: at 1280 px the list was squeezed beside an empty 440 px column, its numbers broken
  // over three lines and its amounts cut off. The column now exists only while an invoice is open.
  it('keeps the list full width until an invoice is open, then gives the invoice its own column', () => {
    invoices = [invoice];
    renderPage();
    const layout = () => screen.getByRole('table', { name: 'Invoices' }).closest('.grid');
    expect(screen.getByText('Open an invoice to see its lines and payments.')).toBeTruthy();
    expect(layout()?.className).not.toContain('xl:grid-cols-');
    fireEvent.click(screen.getByRole('button', { name: 'INV-2026-000004' }));
    expect(screen.getByText('Invoice pane i-1')).toBeTruthy();
    expect(layout()?.className).toContain('xl:grid-cols-[minmax(0,1fr)_440px]');
  });

  // W26: the headers sort on the server (billing api-design 08); the issue time is the default order.
  it('sends the header sort to the invoice query from page 1', () => {
    invoices = [invoice];
    renderPage();
    const table = within(screen.getByRole('table', { name: 'Invoices' }));
    expect(table.getByRole('button', { name: 'Issued' }).closest('th')!.getAttribute('aria-sort')).toBe(
      'descending',
    );
    fireEvent.click(table.getByRole('button', { name: 'Total' }));
    expect(invoiceFilters.at(-1)).toMatchObject({ pageNumber: 1, sort: 'totalVnd', order: 'asc' });
    // The default column toggles two directions (chapter 06 §11.2); newest first is the default
    // order and sends no sort.
    fireEvent.click(table.getByRole('button', { name: 'Issued' }));
    expect(invoiceFilters.at(-1)).toMatchObject({ sort: 'issuedAt', order: 'asc' });
    fireEvent.click(table.getByRole('button', { name: 'Issued' }));
    expect(invoiceFilters.at(-1)).toEqual({ pageNumber: 1, contractId: undefined });
  });
});

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
