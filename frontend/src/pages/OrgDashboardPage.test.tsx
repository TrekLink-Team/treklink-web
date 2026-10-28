// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { landingRoute, type SessionUser } from '../entities/session/model';
import { OrgDashboardPage } from './OrgDashboardPage';

let organizationStatus = 'ACTIVE';
let contracts: object[] = [];
let invoices: object[] = [];
let overdue: object[] = [];

vi.mock('../app/providers/useAuth', () => ({
  useAuth: () => ({
    user: {
      organization: {
        id: 'org-1',
        code: 'ORG-0001',
        legalName: 'TrekLink Demo Tours',
        status: organizationStatus,
        memberRole: 'MANAGER',
      },
    },
  }),
}));

vi.mock('../entities/contract/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../entities/contract/api')>()),
  useContracts: () => ({ data: { items: contracts }, isLoading: false, error: null }),
  fetchContract: (id: string) =>
    Promise.resolve({
      id,
      devices: [
        { deviceId: 'd-1', handedOverAt: '2026-10-25T03:00:00Z', checkedInAt: null, lostAt: null },
        { deviceId: 'd-2', handedOverAt: '2026-10-25T03:00:00Z', checkedInAt: null, lostAt: null },
        {
          deviceId: 'd-3',
          handedOverAt: '2026-10-25T03:00:00Z',
          checkedInAt: '2026-10-28T03:00:00Z',
          lostAt: null,
        },
      ],
    }),
}));

vi.mock('../entities/billing/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../entities/billing/api')>()),
  useInvoices: (_scope: string, filters: { overdue?: boolean }) => ({
    data: { items: filters.overdue ? overdue : invoices },
    isLoading: false,
    error: null,
  }),
}));

const contract = (code: string, status: string, overrides: object = {}) => ({
  id: `c-${code}`,
  code,
  status,
  currentTerm: { seq: 1, startsAt: '2026-10-25T02:00:00Z', endsAt: '2026-11-25T02:00:00Z' },
  returnDueAt: null,
  ...overrides,
});

const invoice = (number: string, status: string, totalVnd: number, paidVnd: number) => ({
  id: `i-${number}`,
  number,
  status,
  totalVnd,
  paidVnd,
  contract: { id: 'c-1', code: 'RC-2026-0001' },
});

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <OrgDashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

// The summary tile with this label (a link), not a table header of the same text.
const tile = (label: string) =>
  screen
    .getAllByText(label)
    .map((element) => element.closest('a'))
    .find((link) => link !== null) as HTMLElement;

afterEach(() => {
  cleanup();
  organizationStatus = 'ACTIVE';
  contracts = [];
  invoices = [];
  overdue = [];
});

describe('OrgDashboardPage (screen 5.6)', () => {
  it('sums the contracts, the devices out and what is still due', async () => {
    contracts = [
      contract('RC-2026-0001', 'ACTIVE'),
      contract('RC-2026-0002', 'OVERDUE', { returnDueAt: '2026-10-20T02:00:00Z' }),
      contract('RC-2026-0003', 'REQUESTED'),
    ];
    invoices = [
      invoice('INV-2026-000001', 'PARTIALLY_PAID', 2_250_000, 1_125_000),
      invoice('INV-2026-000002', 'ISSUED', 900_000, 0),
      invoice('INV-2026-000003', 'PAID', 500_000, 500_000),
    ];
    overdue = [invoices[1]];
    renderPage();

    expect(within(tile('Running contracts')).getByText('2')).toBeTruthy();
    expect(within(tile('Running contracts')).getByText('1 requested, 0 approved')).toBeTruthy();
    // Two running contracts, two units out on each.
    await waitFor(() => expect(within(tile('Devices out')).getByText('4')).toBeTruthy());
    expect(within(tile('Return due or overdue')).getByText('1')).toBeTruthy();
    expect(within(tile('Still due')).getByText('2,025,000 VND')).toBeTruthy();
    expect(within(tile('Still due')).getByText('1 invoice with an overdue line')).toBeTruthy();
    expect(tile('Still due').getAttribute('href')).toBe('/o/invoices');

    const rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('INV-2026-000002')).toBeTruthy();
    expect(within(rows[0]).getByText('Overdue')).toBeTruthy();
    expect(screen.queryByText('INV-2026-000003')).toBeNull();
    expect(screen.getByText('Return due 20 Oct 2026')).toBeTruthy();
  });

  it('leaves out a cancelled contract whose CLOSING adjustment settled its earlier invoice', () => {
    invoices = [
      {
        ...invoice('INV-2026-000001', 'PARTIALLY_PAID', 2_250_000, 1_125_000),
        contract: { id: 'c-2', code: 'RC-2026-0002' },
      },
      {
        ...invoice('INV-2026-000002', 'PAID', -1_125_000, 0),
        contract: { id: 'c-2', code: 'RC-2026-0002' },
      },
      invoice('INV-2026-000004', 'ISSUED', 400_000, 0),
    ];
    overdue = [invoices[0]];
    renderPage();
    expect(within(tile('Still due')).getByText('400,000 VND')).toBeTruthy();
    expect(within(tile('Still due')).getByText('1 unpaid invoice')).toBeTruthy();
    expect(screen.queryByText('INV-2026-000001')).toBeNull();
    expect(screen.getByText('INV-2026-000004')).toBeTruthy();
  });

  it('greets an organization with no contracts and nothing to pay', () => {
    renderPage();
    expect(screen.getByText('Your organization has no contracts yet.')).toBeTruthy();
    expect(screen.getByText('Nothing to pay right now.')).toBeTruthy();
    expect(screen.getByText('Incidents are not available yet.')).toBeTruthy();
  });

  it('shows MSG28 when the organization is not ACTIVE', () => {
    organizationStatus = 'SUSPENDED';
    renderPage();
    expect(screen.getByText('This cannot be done while it is SUSPENDED.')).toBeTruthy();
  });
});

describe('landingRoute (D-059 rule 1)', () => {
  const user = (memberRole: 'MANAGER' | 'OPERATOR') =>
    ({
      accountType: 'ORGANIZATION',
      organization: { memberRole },
    }) as unknown as SessionUser;

  it('lands the Org Manager on /o and the Org Operator on the live map', () => {
    expect(landingRoute(null, user('MANAGER'), 'http://localhost')).toBe('/o');
    expect(landingRoute(null, user('OPERATOR'), 'http://localhost')).toBe('/o/map');
  });
});
