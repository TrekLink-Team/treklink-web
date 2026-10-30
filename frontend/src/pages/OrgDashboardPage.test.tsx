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
let contractPages = 1;
let detailFails = false;
let overdueError: Error | null = null;
let overdueLoading = false;
let openIncidents: object[] = [];
let incidentsError: Error | null = null;
const filtersSeen: object[] = [];

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
  useContracts: (_scope: string, filters: object) => {
    filtersSeen.push(filters);
    return { data: { items: contracts, totalPages: contractPages }, isLoading: false, error: null };
  },
  fetchContract: (id: string) =>
    detailFails
      ? Promise.reject(new Error('network down'))
      : Promise.resolve({
          id,
          devices: [
            {
              deviceId: 'd-1',
              handedOverAt: '2026-10-25T03:00:00Z',
              checkedInAt: null,
              lostAt: null,
            },
            {
              deviceId: 'd-2',
              handedOverAt: '2026-10-25T03:00:00Z',
              checkedInAt: null,
              lostAt: null,
            },
            {
              deviceId: 'd-3',
              handedOverAt: '2026-10-25T03:00:00Z',
              checkedInAt: '2026-10-28T03:00:00Z',
              lostAt: null,
            },
          ],
        }),
}));

vi.mock('../entities/incident/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../entities/incident/api')>()),
  // Answers like the server: only the incidents in the requested states.
  useFleetIncidents: (states: readonly string[]) => {
    filtersSeen.push({ states });
    return incidentsError
      ? { data: undefined, isLoading: false, error: incidentsError, refetch: vi.fn() }
      : {
          data: {
            items: openIncidents.filter((incident) =>
              states.includes((incident as { state: string }).state),
            ),
            totalPages: 1,
          },
          isLoading: false,
          error: null,
        };
  },
}));

vi.mock('../entities/billing/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../entities/billing/api')>()),
  useInvoices: (_scope: string, filters: { overdue?: boolean }) => {
    filtersSeen.push(filters);
    if (filters.overdue && overdueLoading)
      return { data: undefined, isLoading: true, error: null, refetch: vi.fn() };
    return filters.overdue && overdueError
      ? { data: undefined, isLoading: false, error: overdueError, refetch: vi.fn() }
      : {
          data: { items: filters.overdue ? overdue : invoices, totalPages: 1 },
          isLoading: false,
          error: null,
        };
  },
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
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
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
  contractPages = 1;
  detailFails = false;
  overdueError = null;
  overdueLoading = false;
  openIncidents = [];
  incidentsError = null;
  filtersSeen.length = 0;
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

  it('reads one page of MAX_PAGE_SIZE per source, and says so when there is more (review of #109)', () => {
    contracts = [contract('RC-2026-0001', 'ACTIVE')];
    contractPages = 2;
    renderPage();
    expect(filtersSeen).toContainEqual({ pageSize: 100 });
    expect(filtersSeen).toContainEqual({ overdue: true, pageSize: 100 });
    expect(screen.getByText(/Counted on the first 100 contracts./)).toBeTruthy();
  });

  it('shows a failed contract detail as an error with Try again, not as fewer devices', async () => {
    contracts = [contract('RC-2026-0001', 'ACTIVE')];
    detailFails = true;
    renderPage();
    await waitFor(() =>
      expect(screen.getByText('Something went wrong. Please try again.')).toBeTruthy(),
    );
    expect(screen.queryByText('Devices out')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Try again' }).length).toBeGreaterThan(0);
  });

  it('shows a failed overdue query on the Still due tile instead of a count without it', () => {
    invoices = [invoice('INV-2026-000004', 'ISSUED', 400_000, 0)];
    overdueError = new Error('timeout');
    renderPage();
    expect(screen.queryAllByText('Still due').every((element) => !element.closest('a'))).toBe(true);
    expect(screen.getAllByRole('button', { name: 'Try again' }).length).toBeGreaterThan(0);
  });

  it('keeps Invoices to pay loading while the overdue query loads (review of #109)', () => {
    invoices = [invoice('INV-2026-000004', 'ISSUED', 400_000, 0)];
    overdueLoading = true;
    renderPage();
    expect(screen.getByText('Loading Invoices to pay')).toBeTruthy();
    expect(screen.queryByText('INV-2026-000004')).toBeNull();
  });

  it('shows a failed overdue query on Invoices to pay, not rows without the Overdue badge (review of #109)', () => {
    invoices = [invoice('INV-2026-000004', 'ISSUED', 400_000, 0)];
    overdueError = new Error('timeout');
    renderPage();
    expect(screen.queryByText('INV-2026-000004')).toBeNull();
    expect(screen.queryByText('Nothing to pay right now.')).toBeNull();
    // One Try again on the Still due tile, one on the widget.
    expect(screen.getAllByRole('button', { name: 'Try again' })).toHaveLength(2);
  });

  it('keeps a defaulted contract out of Running contracts but counts its devices out', async () => {
    contracts = [
      contract('RC-2026-0001', 'ACTIVE'),
      contract('RC-2026-0003', 'DEFAULTED', { returnDueAt: '2026-09-30T02:00:00Z' }),
    ];
    renderPage();
    expect(within(tile('Running contracts')).getByText('1')).toBeTruthy();
    expect(within(tile('Running contracts')).getByText('0 requested, 0 approved, 1 defaulted')).toBeTruthy();
    await waitFor(() => expect(within(tile('Devices out')).getByText('4')).toBeTruthy());
  });

  it('leaves a resolved or false-alarm incident out of the open incidents', () => {
    openIncidents = (['RESOLVED', 'FALSE_ALARM', 'RESPONDING'] as const).map((state, n) => ({
      id: `inc-${n}`,
      code: `INC-2026-00000${n + 1}`,
      device: { id: `d-${n}`, assetTag: `TL-000${n + 1}`, holder: null },
      state,
      firstEventAt: '2026-10-30T02:00:00Z',
    }));
    renderPage();
    expect(screen.queryByText('INC-2026-000001')).toBeNull();
    expect(screen.queryByText('INC-2026-000002')).toBeNull();
    expect(screen.getByText('INC-2026-000003')).toBeTruthy();
  });

  it('greets an organization with no contracts and nothing to pay', () => {
    renderPage();
    expect(screen.getByText('Your organization has no contracts yet.')).toBeTruthy();
    expect(screen.getByText('Nothing to pay right now.')).toBeTruthy();
    expect(screen.getByText('No open incidents.')).toBeTruthy();
  });

  it('lists five open incidents with tag, holder, state and start, each linking to screen 8.1', () => {
    openIncidents = Array.from({ length: 6 }, (_, n) => ({
      id: `inc-${n}`,
      code: `INC-2026-00000${n + 1}`,
      device: {
        id: `d-${n}`,
        assetTag: `TL-000${n + 1}`,
        holder: n === 0 ? { name: 'Nguyen Van A', phone: null } : null,
      },
      state: n === 0 ? 'NOTIFY_PRIMARY' : 'ACKNOWLEDGED',
      firstEventAt: '2026-10-30T02:00:00Z',
    }));
    renderPage();
    expect(filtersSeen).toContainEqual({
      states: expect.not.arrayContaining(['RESOLVED', 'FALSE_ALARM', 'CLOSED']) as unknown,
    });
    const first = screen.getByText('INC-2026-000001');
    expect(first.closest('a')?.getAttribute('href')).toBe('/o/incidents/inc-0');
    expect(screen.getByText(/TL-0001, Nguyen Van A, since/)).toBeTruthy();
    expect(screen.queryByText('INC-2026-000006')).toBeNull();
    expect(screen.getByText('All incidents').closest('a')?.getAttribute('href')).toBe(
      '/o/incidents',
    );
  });

  it('shows a failed incident read with Try again, not as no incidents', () => {
    incidentsError = new Error('timeout');
    renderPage();
    expect(screen.queryByText('No open incidents.')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Try again' })).toHaveLength(1);
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
