// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InvoiceDetailView } from './InvoiceDetailView';

let settled = false;

vi.mock('../../entities/billing/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../entities/billing/api')>()),
  useInvoice: () => ({
    data: {
      id: 'i-1',
      number: 'INV-2026-000001',
      status: 'ISSUED',
      kind: 'TERM',
      term: { seq: 1 },
      contract: { id: 'c-1', code: 'RC-2026-0002' },
      issuedAt: '2026-10-28T03:00:00Z',
      totalVnd: 2_250_000,
      paidVnd: 0,
      lines: [],
      payments: [],
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useBalance: () => ({
    data: { contractId: 'c-1', dueNowVnd: 0, dueLaterVnd: 0, paidVnd: 0, settled },
  }),
}));

const renderView = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <InvoiceDetailView
          invoiceId="i-1"
          contractPath={(id) => `/t/contracts/${id}`}
          canRecordCounter
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );

afterEach(cleanup);

describe('InvoiceDetailView, Record counter payment (6.3, ruling on #87 point 4)', () => {
  it('offers it while the contract balance is open', () => {
    settled = false;
    renderView();
    expect(screen.getByRole('button', { name: 'Record counter payment' })).toBeTruthy();
  });

  it('hides it when the contract balance is settled, though the invoice shows an amount due', () => {
    settled = true;
    renderView();
    expect(screen.getByText('Still due').nextElementSibling?.textContent).toBe('2,250,000 VND');
    expect(screen.queryByRole('button', { name: 'Record counter payment' })).toBeNull();
  });
});
