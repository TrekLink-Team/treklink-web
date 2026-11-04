// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InvoiceDetailView } from './InvoiceDetailView';

let settled = false;
let lines: unknown[] = [];
const line = (seq: number, description: string, paidVnd: number, type = 'HOLDING_FEE') => ({
  seq,
  type,
  description,
  quantity: 1,
  unitVnd: 750_000,
  amountVnd: 750_000,
  dueAt: '2026-10-28T03:00:00Z',
  paidVnd,
});
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
      lines,
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

const renderView = (canPayOnline = false, asPageTitle = false) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <InvoiceDetailView
          invoiceId="i-1"
          contractPath={(id) => `/t/contracts/${id}`}
          canRecordCounter={!canPayOnline}
          canPayOnline={canPayOnline}
          asPageTitle={asPageTitle}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );

afterEach(cleanup);
beforeEach(() => {
  settled = false;
  balanceAvailable = true;
  balanceRequests.length = 0;
  lines = [];
});

describe('InvoiceDetailView, lines on CollectionView (screen 6.1, D-096)', () => {
  it('searches the lines and narrows them by status from Show', () => {
    lines = [
      line(1, 'Holding fee, term 1', 750_000),
      line(2, 'Monthly fee, TrekLink v3', 0, 'TERM_BALANCE'),
      line(3, 'Late return', 0, 'ADJUSTMENT'),
    ];
    renderView();
    const table = () => within(screen.getByRole('table', { name: 'Lines of INV-2026-000001' }));
    expect(table().getAllByRole('row')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: /^Show: Every status/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Paid' }));
    expect(table().getAllByRole('row')).toHaveLength(2);
    expect(table().getByText('Holding fee, term 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Show: Paid/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Every status' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search lines' }), { target: { value: 'adjustment' } });
    expect(table().getAllByRole('row')).toHaveLength(2);
    expect(table().getByText('Late return')).toBeTruthy();
  });
});


// A matchMedia that answers for a 360 px window (chapter 06 §10.5).
const atPhone = () =>
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0) <= 360,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));

describe('InvoiceDetailView, lines on a phone (review of treklink-web#355)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the type, quantity and due date in each phone row', () => {
    atPhone();
    lines = [line(1, 'Term 1, 3 units', 0)];
    renderView();
    expect(screen.queryByRole('table', { name: 'Lines of INV-2026-000001' })).toBeNull();
    const row = within(screen.getByRole('list', { name: 'Lines of INV-2026-000001' })).getByRole('listitem');
    // The line type reads as its label, never the enum code.
    expect(within(row).getByText('Holding fee')).toBeTruthy();
    expect(within(row).queryByText('HOLDING_FEE')).toBeNull();
    expect(within(row).getByText('1 x 750,000 VND')).toBeTruthy();
    expect(within(row).getByText(/^Due \d{2} \w{3} 2026$/)).toBeTruthy();
  });
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

describe('InvoiceDetailView heading', () => {
  it('makes the invoice number the page h1 on its own page, and an h2 beside the Staff list', () => {
    renderView(true, true);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
    cleanup();

    renderView();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBeTruthy();
  });
});
