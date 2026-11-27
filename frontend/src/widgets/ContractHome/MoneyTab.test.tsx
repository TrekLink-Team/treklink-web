// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Balance, Invoice, Payment } from '../../entities/billing/api';
import type { ContractDetail } from '../../entities/contract/api';
import { ApiError } from '../../shared/api/apiClient';
import { formatDateTime } from '../../shared/lib/format';
import { MoneyTab } from './MoneyTab';

// The Money tab of the contract home (screen 5.2, billing api-design 08, 10, 14 and 19, D-097).
// The API client answers by endpoint, and useMediaQuery picks the balance layout; the billing hooks,
// CollectionView, ServiceCreditsCard and MarkRefundedDialog run for real. ContractDetailPage.test
// covers the owed text for the Manager and the shared details pane; this file covers the rest.
let answers: Record<string, () => Promise<unknown>> = {};
const api = vi.fn((endpoint: string) => {
  const answer = answers[endpoint.split('?')[0]];
  return answer ? answer() : new Promise(() => undefined);
});
vi.mock('../../shared/api/apiClient', async (original) => ({
  ...(await original<typeof import('../../shared/api/apiClient')>()),
  apiClient: (endpoint: string) => api(endpoint),
}));
const media = { wide: true };
vi.mock('../../shared/lib/useMediaQuery', () => ({ useMediaQuery: () => media.wide }));

const contract = (extra: Partial<ContractDetail> = {}): ContractDetail =>
  ({
    id: 'c-1',
    code: 'RC-2026-0004',
    organization: { id: 'org-1', code: 'ORG-0001', legalName: 'Acme Trek' },
    status: 'ACTIVE',
    handedOverAt: null,
    ...extra,
  }) as unknown as ContractDetail;

const BALANCE: Balance = {
  contractId: 'c-1',
  dueNowVnd: 1_500_000,
  dueLaterVnd: 2_250_000,
  paidVnd: 750_000,
  pendingDamageCharges: [],
  settled: false,
};
const invoice = (id: string, extra: Partial<Invoice> = {}): Invoice =>
  ({
    id,
    number: `INV-2026-00000${id.slice(-1)}`,
    organization: { id: 'org-1', code: 'ORG-0001' },
    contract: { id: 'c-1', code: 'RC-2026-0004' },
    kind: 'TERM_INVOICE',
    term: { seq: 1 },
    status: 'ISSUED',
    totalVnd: 2_250_000,
    paidVnd: 0,
    creditDueVnd: null,
    refund: null,
    issuedAt: '2026-10-30T02:00:00Z',
    ...extra,
  }) as Invoice;
const payment = (id: string, extra: Partial<Payment> = {}): Payment => ({
  id,
  reference: `TL-PAY-000${id.slice(-1)}`,
  invoiceId: 'i-1',
  contractId: 'c-1',
  amountVnd: 750_000,
  method: 'CASH',
  status: 'CONFIRMED',
  isSandbox: false,
  expiresAt: null,
  confirmedAt: '2026-10-30T03:00:00Z',
  ...extra,
});
const page = <T,>(items: T[]) => ({ items, pageNumber: 1, pageSize: 20, totalCount: items.length });
const ok = (value: unknown) => () => Promise.resolve(value);

const Where: React.FC = () => {
  const location = useLocation();
  return <p>Now at {location.pathname + location.search}</p>;
};
const show = (props: Partial<React.ComponentProps<typeof MoneyTab>> = {}) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/contract']}>
        <Routes>
          <Route
            path="/contract"
            element={<MoneyTab contract={contract()} scope="o" canPay={false} {...props} />}
          />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

const balanceCard = () =>
  screen.getByRole('heading', { name: 'Balance' }).closest('[aria-live]') as HTMLElement;
const invoices = () => screen.findByRole('table', { name: 'Invoices of RC-2026-0004' });
const payments = () => screen.findByRole('table', { name: 'Payments of RC-2026-0004' });
const cells = (table: HTMLElement, name: string) => {
  const row = within(table)
    .getByRole('button', { name: `Show details of ${name}` })
    .closest('tr');
  return Array.from(row?.children ?? []).map((cell) => cell.textContent ?? '');
};

beforeEach(() => {
  api.mockClear();
  answers = {
    '/contracts/c-1/balance': ok(BALANCE),
    '/invoices': ok(page([invoice('i-1')])),
    '/payments': ok(page([payment('p-1')])),
  };
  media.wide = true;
});
afterEach(cleanup);

describe('MoneyTab', () => {
  describe('Balance', () => {
    it('shows due now, due later and paid', async () => {
      show();
      const card = within(balanceCard());
      expect(await card.findByText('1,500,000 VND')).toBeTruthy();
      expect(card.getByText('Due now')).toBeTruthy();
      expect(card.getByText('Due later')).toBeTruthy();
      expect(card.getByText('2,250,000 VND')).toBeTruthy();
      expect(card.getByText('Paid')).toBeTruthy();
      expect(card.getByText('750,000 VND')).toBeTruthy();
      expect(card.queryByText(/TrekLink owes/)).toBeNull();
    });

    it('lists the three figures as one definition list below 600 px', async () => {
      media.wide = false;
      show();
      const card = within(balanceCard());
      await card.findByText('1,500,000 VND');
      expect(card.getAllByRole('term').map((term) => term.textContent)).toEqual([
        'Due now',
        'Due later',
        'Paid',
      ]);
      expect(card.getAllByRole('definition').map((value) => value.textContent)).toEqual([
        '1,500,000 VND',
        '2,250,000 VND',
        '750,000 VND',
      ]);
    });

    it('shows a loading state, then a failure with Try again', async () => {
      answers['/contracts/c-1/balance'] = () => new Promise(() => undefined);
      show();
      expect(within(balanceCard()).getByRole('status')).toBeTruthy();
      cleanup();
      let calls = 0;
      answers['/contracts/c-1/balance'] = () =>
        ++calls === 1
          ? Promise.reject(new ApiError(500, 'INTERNAL', 'The balance could not be read.'))
          : Promise.resolve(BALANCE);
      show();
      const card = within(balanceCard());
      expect((await card.findByRole('alert')).textContent).toContain(
        'The balance could not be read.',
      );
      fireEvent.click(card.getByRole('button', { name: 'Try again' }));
      expect(await card.findByText('1,500,000 VND')).toBeTruthy();
    });

    it('tells Staff what TrekLink owes the organization and where the refund is marked', async () => {
      answers['/contracts/c-1/balance'] = ok({ ...BALANCE, owedToOrganizationVnd: 720_000 });
      show({ scope: 't' });
      expect(
        (await within(balanceCard()).findByText(/^TrekLink owes/)).textContent?.replace(
          /\s+/g,
          ' ',
        ),
      ).toBe(
        'TrekLink owes Acme Trek 720,000 VND. It is refunded outside TrekLink, then marked refunded on the closing invoice.',
      );
    });

    it('counts the damage charges waiting for an Admin', async () => {
      const charge = { id: 'dc-1' };
      answers['/contracts/c-1/balance'] = ok({ ...BALANCE, pendingDamageCharges: [charge] });
      show();
      expect(
        await screen.findByText(/1 damage charge waits\s+for a TrekLink Admin\./),
      ).toBeTruthy();
      cleanup();
      answers['/contracts/c-1/balance'] = ok({
        ...BALANCE,
        pendingDamageCharges: [charge, charge],
      });
      show();
      expect(
        await screen.findByText(/2 damage charges wait\s+for a TrekLink Admin\./),
      ).toBeTruthy();
    });
  });

  describe('Invoices', () => {
    it('reads the invoices of this contract and lists kind, term, issue time, amounts and status', async () => {
      answers['/invoices'] = ok(
        page([
          invoice('i-1', { status: 'PARTIALLY_PAID', paidVnd: 750_000 }),
          invoice('i-2', {
            kind: 'CLOSING',
            term: null,
            status: 'CREDIT_DUE',
            totalVnd: -720_000,
            creditDueVnd: 720_000,
          }),
        ]),
      );
      show();
      const table = await invoices();
      expect(cells(table, 'INV-2026-000001').slice(1, 7)).toEqual([
        'Term invoice',
        'Term 1',
        formatDateTime('2026-10-30T02:00:00Z'),
        '2,250,000 VND',
        '750,000 VND',
        'Partly paid',
      ]);
      expect(cells(table, 'INV-2026-000002').slice(1, 7)).toEqual([
        'Closing',
        'None',
        formatDateTime('2026-10-30T02:00:00Z'),
        '-720,000 VND',
        '0 VND',
        'Credit due to organization: 720,000 VND',
      ]);
      expect(api).toHaveBeenCalledWith('/invoices?contractId=c-1');
      expect(api).toHaveBeenCalledWith('/payments?contractId=c-1');
    });

    it('links the organization to its invoice pages and Staff to billing', async () => {
      show();
      expect(
        screen.getByRole('link', { name: 'All invoices of RC-2026-0004' }).getAttribute('href'),
      ).toBe('/o/invoices?contractId=c-1');
      const table = await invoices();
      expect(
        within(table).getByRole('link', { name: 'INV-2026-000001' }).getAttribute('href'),
      ).toBe('/o/invoices/i-1');
      cleanup();
      show({ scope: 't' });
      expect(
        screen.getByRole('link', { name: 'All invoices of RC-2026-0004' }).getAttribute('href'),
      ).toBe('/t/billing?contractId=c-1');
    });

    it('opens an unpaid invoice from Pay invoice, and leaves it unavailable on a paid one', async () => {
      answers['/invoices'] = ok(
        page([invoice('i-1'), invoice('i-2', { status: 'PAID', paidVnd: 2_250_000 })]),
      );
      show({ canPay: true });
      await invoices();
      expect(
        screen
          .getByRole('button', { name: 'Pay invoice INV-2026-000002' })
          .getAttribute('aria-disabled'),
      ).toBe('true');
      fireEvent.click(screen.getByRole('button', { name: 'Pay invoice INV-2026-000001' }));
      expect(screen.getByText('Now at /o/invoices/i-1')).toBeTruthy();
    });

    it('offers no Pay invoice to a reader who may not pay', async () => {
      show({ canPay: false });
      await invoices();
      expect(screen.queryByRole('button', { name: /^Pay invoice/ })).toBeNull();
    });

    it('lets Staff mark a credit due refunded, and only then', async () => {
      answers['/invoices'] = ok(
        page([
          invoice('i-1', { status: 'CREDIT_DUE', totalVnd: -720_000, creditDueVnd: 720_000 }),
          invoice('i-2'),
        ]),
      );
      show({ scope: 't' });
      await invoices();
      expect(
        screen
          .getByRole('button', { name: 'Mark refunded INV-2026-000002' })
          .getAttribute('aria-disabled'),
      ).toBe('true');
      fireEvent.click(screen.getByRole('button', { name: 'Mark refunded INV-2026-000001' }));
      expect(screen.getByRole('dialog', { name: 'Mark INV-2026-000001 refunded?' })).toBeTruthy();
      cleanup();
      show({ scope: 'o' });
      await invoices();
      expect(screen.queryByRole('button', { name: /^Mark refunded/ })).toBeNull();
    });

    it('says when the contract has no invoice yet', async () => {
      answers['/invoices'] = ok(page([]));
      show();
      expect(await screen.findByText('No invoices yet.')).toBeTruthy();
      expect(screen.getByText('Term 1 and its invoice are created with the request.')).toBeTruthy();
    });

    it('shows a failed read of the invoices with Try again', async () => {
      let calls = 0;
      answers['/invoices'] = () =>
        ++calls === 1
          ? Promise.reject(new ApiError(500, 'INTERNAL', 'Invoices failed.'))
          : Promise.resolve(page([invoice('i-1')]));
      show();
      expect(await screen.findByText('Invoices failed.')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(await within(await invoices()).findByText('INV-2026-000001')).toBeTruthy();
    });
  });

  describe('Payments', () => {
    it('lists the invoice, method, amount, status and confirmation of each payment', async () => {
      answers['/payments'] = ok(
        page([
          payment('p-1'),
          payment('p-2', {
            invoiceId: 'i-9',
            method: 'BANK_TRANSFER',
            status: 'FAILED',
            confirmedAt: null,
          }),
        ]),
      );
      show();
      const table = await payments();
      await within(await invoices()).findByText('INV-2026-000001');
      expect(cells(table, 'TL-PAY-0001').slice(1, 6)).toEqual([
        'INV-2026-000001',
        'Cash',
        '750,000 VND',
        'Confirmed',
        formatDateTime('2026-10-30T03:00:00Z'),
      ]);
      expect(cells(table, 'TL-PAY-0002').slice(1, 6)).toEqual([
        'Invoice not listed',
        'Bank transfer',
        '750,000 VND',
        'Failed',
        'Not yet',
      ]);
    });

    it('returns the payer to a waiting SePay QR only', async () => {
      answers['/payments'] = ok(
        page([
          payment('p-1', { method: 'SEPAY', status: 'PENDING', confirmedAt: null }),
          payment('p-2', { method: 'SEPAY', status: 'EXPIRED', confirmedAt: null }),
        ]),
      );
      show({ canPay: true });
      await payments();
      expect(
        screen
          .getByRole('button', { name: 'Show the QR TL-PAY-0002' })
          .getAttribute('aria-disabled'),
      ).toBe('true');
      fireEvent.click(screen.getByRole('button', { name: 'Show the QR TL-PAY-0001' }));
      expect(screen.getByText('Now at /o/pay/p-1')).toBeTruthy();
    });

    it('says when nothing was paid yet', async () => {
      answers['/payments'] = ok(page([]));
      show();
      expect(await screen.findByText('No payments yet.')).toBeTruthy();
    });
  });

  describe('Service credits', () => {
    it('appear once the contract is handed over, and not before', async () => {
      show({ contract: contract({ handedOverAt: '2026-10-30T09:00:00Z' }) });
      expect(screen.getByRole('heading', { name: 'Service credits' })).toBeTruthy();
      expect(api).toHaveBeenCalledWith('/contracts/c-1/service-credits?pageSize=100');
      cleanup();
      api.mockClear();
      show();
      expect(screen.queryByRole('heading', { name: 'Service credits' })).toBeNull();
      expect(api.mock.calls.some(([url]) => url.includes('service-credits'))).toBe(false);
    });
  });
});
