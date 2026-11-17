// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InvoicesPage } from './InvoicesPage';

const api = vi.fn();
vi.mock('../shared/api/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/api/apiClient')>()),
  apiClient: (...args: unknown[]) => api(...args),
}));

const invoice = (id: string, number: string) => ({
  id,
  number,
  organization: { id: 'o-1', code: 'ORG-0001' },
  contract: { id: 'c-1', code: 'RC-2026-0001' },
  kind: 'TERM',
  term: { seq: 1 },
  status: 'ISSUED',
  totalVnd: 2_250_000,
  paidVnd: 0,
  issuedAt: '2026-10-30T03:00:00Z',
});

const renderPage = (search = '') =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[`/o/invoices${search}`]}>
        <InvoicesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

afterEach(() => {
  cleanup();
  api.mockReset();
});

const lastGet = () => String(api.mock.calls[api.mock.calls.length - 1][0]);

// /o/invoices (screen 6.1, billing api-design 08): the Org Manager's list sorts on the server (W26).
describe('InvoicesPage (/o/invoices, screen 6.1)', () => {
  it('sends the header sort as sort and order, and the default order sends neither', async () => {
    api.mockResolvedValue({
      items: [
        invoice('i-1', 'INV-2026-0001'),
        invoice('i-2', 'INV-2026-0002'),
        invoice('i-3', 'INV-2026-0003'),
      ],
      pageNumber: 1,
      pageSize: 20,
      totalCount: 3,
      totalPages: 1,
    });
    renderPage();
    const header = async (name: string) =>
      within(await screen.findByRole('table', { name: 'Invoices' })).getByRole('button', { name });
    await waitFor(() => expect(lastGet()).toBe('/invoices?pageNumber=1'));
    fireEvent.click(await header('Status'));
    await waitFor(() => expect(lastGet()).toBe('/invoices?pageNumber=1&sort=status&order=asc'));
    fireEvent.click(await header('Status'));
    await waitFor(() => expect(lastGet()).toBe('/invoices?pageNumber=1&sort=status&order=desc'));
    fireEvent.click(await header('Status'));
    await waitFor(() => expect(lastGet()).toBe('/invoices?pageNumber=1'));
  });

  // #501: the totals come from the server for every invoice the filters match, so one row on this page can sit
  // beside a total of many pages.
  it('shows the server totals above the table, not a sum of the page', async () => {
    api.mockResolvedValue({
      items: [invoice('i-1', 'INV-2026-0001')],
      pageNumber: 1,
      pageSize: 1,
      totalCount: 45,
      totalPages: 45,
      totals: { invoicedVnd: 100_000_000, paidVnd: 60_000_000, outstandingVnd: 40_000_000 },
    });
    renderPage();
    const totals = within(await screen.findByTestId('invoice-totals'));
    expect(totals.getByText('100,000,000 VND')).toBeTruthy();
    expect(totals.getByText('60,000,000 VND')).toBeTruthy();
    expect(totals.getByText('40,000,000 VND')).toBeTruthy();
    expect(totals.getByText(/Invoiced = every line of the listed invoices/)).toBeTruthy();
  });

  it('sends the period with the last day included, `to` exclusive, and clears it', async () => {
    api.mockResolvedValue({ items: [], pageNumber: 1, pageSize: 20, totalCount: 0, totalPages: 0 });
    renderPage();
    await waitFor(() => expect(lastGet()).toBe('/invoices?pageNumber=1'));
    fireEvent.change(screen.getByLabelText('Due from'), { target: { value: '2026-11-01' } });
    fireEvent.change(screen.getByLabelText('Due to'), { target: { value: '2026-11-30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(lastGet()).toBe('/invoices?pageNumber=1&from=2026-11-01&to=2026-12-01'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Any period' }));
    await waitFor(() => expect(lastGet()).toBe('/invoices?pageNumber=1'));
  });

  it('refuses a last day before the first day without a request', async () => {
    api.mockResolvedValue({ items: [], pageNumber: 1, pageSize: 20, totalCount: 0, totalPages: 0 });
    renderPage();
    const invoiceReads = () =>
      api.mock.calls.filter(([url]) => String(url).startsWith('/invoices')).length;
    await waitFor(() => expect(invoiceReads()).toBe(1));
    fireEvent.change(screen.getByLabelText('Due from'), { target: { value: '2026-11-10' } });
    fireEvent.change(screen.getByLabelText('Due to'), { target: { value: '2026-11-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText(/last day that is not before it/)).toBeTruthy();
    expect(invoiceReads()).toBe(1);
  });

  it('opens on the variant and period a report row links with, and says which variant', async () => {
    api.mockResolvedValue({ items: [], pageNumber: 1, pageSize: 20, totalCount: 0, totalPages: 0 });
    renderPage('?hardwareVariantId=v-3&from=2026-11-01&to=2026-12-01');
    await waitFor(() =>
      expect(lastGet()).toBe(
        '/invoices?pageNumber=1&hardwareVariantId=v-3&from=2026-11-01&to=2026-12-01',
      ),
    );
    expect(screen.getByText(/Showing variant/)).toBeTruthy();
    expect((screen.getByLabelText('Due from') as HTMLInputElement).value).toBe('2026-11-01');
    expect((screen.getByLabelText('Due to') as HTMLInputElement).value).toBe('2026-11-30');
    fireEvent.click(screen.getByRole('button', { name: 'Show every variant' }));
    await waitFor(() =>
      expect(lastGet()).toBe('/invoices?pageNumber=1&from=2026-11-01&to=2026-12-01'),
    );
  });

  it('drops a malformed or backwards period from the link', async () => {
    api.mockResolvedValue({ items: [], pageNumber: 1, pageSize: 20, totalCount: 0, totalPages: 0 });
    renderPage('?from=2026-12-01&to=2026-11-01');
    await waitFor(() => expect(lastGet()).toBe('/invoices?pageNumber=1'));
  });
});
