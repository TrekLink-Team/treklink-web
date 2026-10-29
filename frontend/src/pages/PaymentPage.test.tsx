// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaymentPage } from './PaymentPage';

let payment: object = {};

vi.mock('../entities/billing/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../entities/billing/api')>()),
  usePayment: () => ({ data: payment, isLoading: false, error: null }),
}));

const expired = (overrides: object = {}) => ({
  id: 'p-1',
  reference: 'TL7K2Q9M4D',
  invoiceId: 'inv-1',
  contractId: 'c-1',
  amountVnd: 1_125_000,
  method: 'SEPAY',
  status: 'EXPIRED',
  isSandbox: true,
  expiresAt: '2026-11-02T03:30:00Z',
  confirmedAt: null,
  vietQr: null,
  receivedLater: [],
  ...overrides,
});

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/o/pay/p-1']}>
        <Routes>
          <Route path="/o/pay/:paymentId" element={<PaymentPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

afterEach(cleanup);

describe('PaymentPage (screen 6.2)', () => {
  it('says nothing was charged for an expired request with no money (MSG25)', () => {
    payment = expired();
    renderPage();
    expect(screen.getByText('Payment not completed.')).toBeTruthy();
    expect(screen.getByText(/Nothing was charged/)).toBeTruthy();
  });

  it('shows money that arrived with another amount instead of "nothing was charged" (review of #92)', () => {
    payment = expired({
      receivedLater: [{ amountVnd: 500_000, confirmedAt: '2026-11-02T04:00:00Z' }],
    });
    renderPage();
    expect(
      screen.getByText('500,000 VND arrived for this request and was credited to the invoice.'),
    ).toBeTruthy();
    expect(screen.queryByText(/Nothing was charged/)).toBeNull();
  });
});
