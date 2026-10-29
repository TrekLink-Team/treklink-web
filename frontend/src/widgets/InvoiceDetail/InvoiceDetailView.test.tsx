// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InvoiceDetailView } from './InvoiceDetailView';

let settled = false;
let balanceAvailable = true;
const balanceRequests: { contractId: string; enabled: boolean }[] = [];

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
  useBalance: (contractId: string, enabled: boolean) => {
    balanceRequests.push({ contractId, enabled });
    return {
      data: balanceAvailable
        ? { contractId: 'c-1', dueNowVnd: 0, dueLaterVnd: 0, paidVnd: 0, settled }
        : undefined,
    };
  },
}));

const renderView = (canPayOnline = false) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <InvoiceDetailView
          invoiceId="i-1"
          contractPath={(id) => `/t/contracts/${id}`}
          canRecordCounter={!canPayOnline}
          canPayOnline={canPayOnline}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );

afterEach(cleanup);
beforeEach(() => {
  settled = false;
  balanceAvailable = true;
  balanceRequests.length = 0;
});

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

  it('offers SePay only while the contract balance is open', () => {
    settled = false;
    renderView(true);
    expect(screen.getByRole('button', { name: 'Pay with SePay' })).toBeTruthy();
    expect(balanceRequests).toContainEqual({ contractId: 'c-1', enabled: true });
  });

  it('hides SePay for an invoice offset by the settled contract cancellation adjustment', () => {
    settled = true;
    renderView(true);
    expect(screen.getByText('Still due').nextElementSibling?.textContent).toBe('2,250,000 VND');
    expect(screen.queryByRole('button', { name: 'Pay with SePay' })).toBeNull();
  });

  it('does not offer SePay until the contract balance is available', () => {
    balanceAvailable = false;
    renderView(true);
    expect(screen.queryByRole('button', { name: 'Pay with SePay' })).toBeNull();
  });
});
