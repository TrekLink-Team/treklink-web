// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InvoiceDetail } from '../../entities/billing/api';
import { CounterPaymentDialog, dueNowOf } from './CounterPaymentDialog';

vi.mock('../../entities/billing/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../entities/billing/api')>()),
  recordCounterPayment: vi.fn(),
}));

const line = (seq: number, amountVnd: number, dueAt: string, paidVnd = 0) => ({
  seq,
  type: 'TERM_FEE',
  description: `Line ${seq}`,
  quantity: 1,
  unitVnd: amountVnd,
  amountVnd,
  dueAt,
  paidVnd,
});

const invoice = {
  id: 'i-1',
  number: 'INV-2026-000004',
  status: 'ISSUED',
  kind: 'TERM',
  contract: { id: 'c-4', code: 'RC-2026-0004' },
  organization: { id: 'o-1', code: 'ORG-0001' },
  totalVnd: 2_250_000,
  paidVnd: 0,
  lines: [line(1, 1_125_000, '2020-01-01T00:00:00Z'), line(2, 1_125_000, '2099-11-30T00:00:00Z')],
  payments: [],
} as unknown as InvoiceDetail;

afterEach(cleanup);

describe('CounterPaymentDialog (screen 6.3)', () => {
  it('prefills and labels what is due now, and shows the later installment apart', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CounterPaymentDialog invoice={invoice} onClose={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(screen.getByText(/Due now/).textContent).toContain('1,125,000 VND');
    expect(screen.getByText(/Due now/).textContent).toContain('Due later');
    expect((screen.getByLabelText(/Amount received/) as HTMLInputElement).value).toBe('1125000');
  });

  it('never counts more than the unpaid total, and nothing for lines not yet due', () => {
    expect(dueNowOf(invoice, 2_250_000, new Date('2026-10-30T00:00:00Z'))).toBe(1_125_000);
    expect(dueNowOf(invoice, 500_000, new Date('2026-10-30T00:00:00Z'))).toBe(500_000);
    expect(dueNowOf({ ...invoice, lines: [invoice.lines[1]] }, 1_125_000)).toBe(0);
  });
});
