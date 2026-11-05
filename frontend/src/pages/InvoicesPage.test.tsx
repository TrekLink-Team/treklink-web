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

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/o/invoices']}>
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
      items: [invoice('i-1', 'INV-2026-0001'), invoice('i-2', 'INV-2026-0002'), invoice('i-3', 'INV-2026-0003')],
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
});
