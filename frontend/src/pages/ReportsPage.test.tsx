// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../shared/api/apiClient';
import { ReportsPage } from './ReportsPage';

const api = vi.fn();
vi.mock('../shared/api/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/api/apiClient')>()),
  apiClient: (...args: unknown[]) => api(...args),
}));

const ROWS: Record<string, unknown[]> = {
  utilization: [
    {
      variant: 'treklink-v2',
      unitsInService: 5,
      rentedUnitDays: 15.5,
      availableUnitDays: 155,
      utilizationPct: 10,
    },
    {
      variant: 'treklink-v3',
      unitsInService: 10,
      rentedUnitDays: 155,
      availableUnitDays: 310,
      utilizationPct: 50,
    },
  ],
  revenue: [
    {
      variant: 'treklink-v3',
      invoicedVnd: 18_000_000,
      paidVnd: 13_500_000,
      outstandingVnd: 4_500_000,
    },
    { variant: 'treklink-v2', invoicedVnd: 2_000_000, paidVnd: 2_000_000, outstandingVnd: 0 },
  ],
  overdue: [
    {
      contractId: 'c-1',
      contractCode: 'RC-2026-0001',
      organization: 'ACME Trek',
      endDate: '2026-10-20',
      daysOverdue: 12,
      unitsOut: 3,
      lateFeeVnd: 150_000,
      state: 'OVERDUE',
    },
  ],
  lost: [
    {
      lossCaseId: 'lc-1',
      assetTag: 'TL-0042',
      variant: 'treklink-v3',
      organization: 'ACME Trek',
      contractId: 'c-1',
      contractCode: 'RC-2026-0001',
      lostAt: '2026-10-15T08:00:00.000Z',
      lossCaseState: 'CONFIRMED',
      chargeVnd: 1_200_000,
    },
    {
      lossCaseId: null,
      assetTag: 'TL-0043',
      variant: null,
      organization: 'Beta Tours',
      contractId: 'c-2',
      contractCode: 'RC-2026-0002',
      lostAt: '2026-10-16T08:00:00.000Z',
      lossCaseState: null,
      chargeVnd: null,
    },
  ],
  'incident-times': [
    {
      organization: 'ACME Trek',
      incidents: 3,
      ackMedianSec: 42,
      ackP95Sec: 90,
      resolveMedianSec: 840,
      resolveP95Sec: 1800,
    },
    {
      organization: 'Beta Tours',
      incidents: 1,
      ackMedianSec: 10,
      ackP95Sec: 10,
      resolveMedianSec: null,
      resolveP95Sec: null,
    },
    {
      organization: null,
      incidents: 4,
      ackMedianSec: 30,
      ackP95Sec: 90,
      resolveMedianSec: 840,
      resolveP95Sec: 1800,
    },
  ],
};

// Answers a report read with the rows of its kind, or with `respond` when the test overrides it.
const serve = (respond?: (endpoint: string) => unknown) =>
  api.mockImplementation((endpoint: string) => {
    if (respond) return Promise.resolve().then(() => respond(endpoint));
    const kind = /\/reports\/([a-z-]+)/.exec(endpoint)?.[1] ?? '';
    if (endpoint.includes('format=csv')) return Promise.resolve('variant\n');
    return Promise.resolve({ kind, from: '2026-11-01', to: '2026-12-01', rows: ROWS[kind] ?? [] });
  });

const Probe: React.FC = () => <p data-testid="search">{useLocation().search}</p>;

// The browser's back button.
const Back: React.FC = () => {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(-1)}>
      Browser back
    </button>
  );
};

const renderPage = (search = '') =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[`/t/reports${search}`]}>
        <ReportsPage />
        <Probe />
        <Back />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const table = (name: string) => within(screen.getByRole('table', { name }));
const tab = (name: string) => screen.getByRole('tab', { name });
const reads = () => api.mock.calls.map((call) => String(call[0]));

beforeEach(() => {
  api.mockReset();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 15, 9, 0, 0));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ReportsPage (screen 9.4)', () => {
  it('opens on utilization for the current month and echoes the last included day', async () => {
    serve();
    renderPage();
    await screen.findByRole('table', { name: 'Utilization by variant' });
    expect(reads()[0]).toBe('/reports/utilization?from=2026-11-01&to=2026-12-01');
    expect(screen.getByText('01 Nov 2026 to 30 Nov 2026')).toBeTruthy();
    expect((screen.getByLabelText(/^From/) as HTMLInputElement).value).toBe('2026-11-01');
    expect((screen.getByLabelText(/^To/) as HTMLInputElement).value).toBe('2026-11-30');
    expect(tab('Utilization').getAttribute('aria-selected')).toBe('true');
  });

  it('shows the utilization table with its bar chart text alternative', async () => {
    serve();
    renderPage();
    await screen.findByRole('table', { name: 'Utilization by variant' });
    expect(table('Utilization by variant').getByText('310')).toBeTruthy();
    expect(table('Utilization by variant').getByText('50 %')).toBeTruthy();
    expect(
      screen.getByRole('img', {
        name: 'Utilization by variant: treklink-v2 10 %, treklink-v3 50 %',
      }),
    ).toBeTruthy();
  });

  it('switches tab through the URL and reads that report', async () => {
    serve();
    renderPage();
    await screen.findByRole('table', { name: 'Utilization by variant' });
    fireEvent.click(tab('Revenue'));
    await screen.findByRole('table', { name: 'Revenue by variant' });
    expect(screen.getByTestId('search').textContent).toBe(
      '?kind=revenue&from=2026-11-01&to=2026-12-01',
    );
    expect(reads()).toContain('/reports/revenue?from=2026-11-01&to=2026-12-01');
  });

  it('opens on the tab and period of the URL', async () => {
    serve();
    renderPage('?kind=overdue&from=2026-10-01&to=2026-11-01');
    await screen.findByRole('table', { name: 'Overdue contracts' });
    expect(reads()[0]).toBe('/reports/overdue?from=2026-10-01&to=2026-11-01');
    expect(screen.getByText('01 Oct 2026 to 31 Oct 2026')).toBeTruthy();
  });

  it('falls back to utilization and the month for a URL that is not valid', async () => {
    serve();
    renderPage('?kind=payroll&from=soon&to=never');
    await screen.findByRole('table', { name: 'Utilization by variant' });
    expect(reads()[0]).toBe('/reports/utilization?from=2026-11-01&to=2026-12-01');
  });

  it('moves between tabs with the arrow keys', async () => {
    serve();
    renderPage();
    await screen.findByRole('table', { name: 'Utilization by variant' });
    fireEvent.keyDown(tab('Utilization'), { key: 'ArrowRight' });
    await screen.findByRole('table', { name: 'Revenue by variant' });
    expect(tab('Revenue').getAttribute('aria-selected')).toBe('true');
  });

  it('moves focus to the table heading on a tab switch', async () => {
    serve();
    renderPage();
    await screen.findByRole('table', { name: 'Utilization by variant' });
    fireEvent.click(tab('Revenue'));
    await screen.findByRole('table', { name: 'Revenue by variant' });
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Revenue', level: 2 }));
  });

  it('shows revenue with a totals row computed from the rows and a chart alternative', async () => {
    serve();
    renderPage('?kind=revenue');
    await screen.findByRole('table', { name: 'Revenue by variant' });
    const rows = table('Revenue by variant').getAllByRole('row');
    const total = within(rows[rows.length - 1]);
    expect(total.getByText('Total')).toBeTruthy();
    expect(total.getByText('20,000,000 VND')).toBeTruthy();
    expect(total.getByText('15,500,000 VND')).toBeTruthy();
    expect(total.getByText('4,500,000 VND')).toBeTruthy();
    expect(
      screen.getByRole('img', { name: /treklink-v3 invoiced 18,000,000 VND, paid 13,500,000 VND/ }),
    ).toBeTruthy();
  });

  it('labels the revenue bars as amounts in VND, as the table does', async () => {
    serve();
    renderPage('?kind=revenue');
    await screen.findByRole('table', { name: 'Revenue by variant' });
    const chart = within(screen.getByRole('img', { name: /^Revenue by variant/ }));
    expect(chart.getByText('18,000,000 VND')).toBeTruthy();
    expect(chart.getByText('13,500,000 VND')).toBeTruthy();
  });

  it('links an overdue contract to its detail page', async () => {
    serve();
    renderPage('?kind=overdue');
    await screen.findByRole('table', { name: 'Overdue contracts' });
    expect(
      table('Overdue contracts').getByRole('link', { name: 'RC-2026-0001' }).getAttribute('href'),
    ).toBe('/t/contracts/c-1');
    expect(table('Overdue contracts').getByText('150,000 VND')).toBeTruthy();
    expect(table('Overdue contracts').getByText('20 Oct 2026')).toBeTruthy();
  });

  it('links a lost unit to its loss case, and shows a unit with none as plain text', async () => {
    serve();
    renderPage('?kind=lost');
    await screen.findByRole('table', { name: 'Lost units' });
    expect(table('Lost units').getByRole('link', { name: 'TL-0042' }).getAttribute('href')).toBe(
      '/t/loss-cases/lc-1',
    );
    expect(table('Lost units').queryByRole('link', { name: 'TL-0043' })).toBeNull();
    expect(table('Lost units').getByText('TL-0043')).toBeTruthy();
    expect(table('Lost units').getByText('1,200,000 VND')).toBeTruthy();
    expect(table('Lost units').getByText('CONFIRMED')).toBeTruthy();
    expect(table('Lost units').getAllByText('No variant').length).toBeGreaterThan(0);
  });

  describe('incident times', () => {
    it('opens the four tiles on the row over every incident', async () => {
      serve();
      renderPage('?kind=incident-times');
      await screen.findByRole('table', { name: 'Incident times by organization' });
      const tiles = within(
        screen.getByRole('region', { name: 'Response times of All organizations' }),
      );
      expect(tiles.getByText('30 s')).toBeTruthy();
      expect(tiles.getByText('2 min')).toBeTruthy();
      expect(tiles.getAllByText('14 min').length).toBeGreaterThan(0);
      expect(tiles.getByText('30 min')).toBeTruthy();
      expect(screen.getByText(/All organizations, 4 incidents/)).toBeTruthy();
    });

    it('shows the tiles of the organization picked in the table, with a dash for a missing figure', async () => {
      serve();
      renderPage('?kind=incident-times');
      await screen.findByRole('table', { name: 'Incident times by organization' });
      fireEvent.click(
        table('Incident times by organization').getByRole('button', { name: 'Beta Tours' }),
      );
      const tiles = within(screen.getByRole('region', { name: 'Response times of Beta Tours' }));
      expect(
        tiles.getByText('Resolve median').closest('div')?.parentElement?.textContent,
      ).toContain('–');
      expect(screen.getByText(/Beta Tours, 1 incident$/)).toBeTruthy();
      expect(
        table('Incident times by organization')
          .getByRole('button', { name: 'Beta Tours' })
          .getAttribute('aria-pressed'),
      ).toBe('true');
    });

    it('opens on the organization with the most incidents when no all-incidents row comes', async () => {
      serve((endpoint) => ({
        kind: 'incident-times',
        from: '2026-11-01',
        to: '2026-12-01',
        rows: endpoint.includes('incident-times') ? (ROWS['incident-times'] ?? []).slice(0, 2) : [],
      }));
      renderPage('?kind=incident-times');
      await screen.findByRole('table', { name: 'Incident times by organization' });
      expect(screen.getByRole('region', { name: 'Response times of ACME Trek' })).toBeTruthy();
    });
  });

  describe('the period', () => {
    it('sends the day after the last included day and writes the period to the URL', async () => {
      serve();
      renderPage();
      await screen.findByRole('table', { name: 'Utilization by variant' });
      fireEvent.change(screen.getByLabelText(/^From/), { target: { value: '2026-10-01' } });
      fireEvent.change(screen.getByLabelText(/^To/), { target: { value: '2026-10-31' } });
      fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
      await waitFor(() =>
        expect(reads()).toContain('/reports/utilization?from=2026-10-01&to=2026-11-01'),
      );
      expect(screen.getByTestId('search').textContent).toBe(
        '?kind=utilization&from=2026-10-01&to=2026-11-01',
      );
    });

    it('blocks a reversed or too long period with MSG35 and sends nothing', async () => {
      serve();
      renderPage();
      await screen.findByRole('table', { name: 'Utilization by variant' });
      const before = reads().length;
      fireEvent.change(screen.getByLabelText(/^To/), { target: { value: '2026-10-01' } });
      fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
      expect(
        await screen.findByText('Choose an end after the start, at most 366 days later.'),
      ).toBeTruthy();
      fireEvent.change(screen.getByLabelText(/^From/), { target: { value: '2024-01-01' } });
      fireEvent.change(screen.getByLabelText(/^To/), { target: { value: '2026-10-01' } });
      fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
      expect(
        screen.getByText('Choose an end after the start, at most 366 days later.'),
      ).toBeTruthy();
      expect(reads()).toHaveLength(before);
    });

    it('puts the period of the URL back in the fields on browser back', async () => {
      serve();
      renderPage('?from=2026-10-01&to=2026-11-01');
      await screen.findByRole('table', { name: 'Utilization by variant' });
      fireEvent.click(screen.getByRole('button', { name: 'This month' }));
      await waitFor(() =>
        expect((screen.getByLabelText(/^From/) as HTMLInputElement).value).toBe('2026-11-01'),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Browser back' }));
      await waitFor(() =>
        expect((screen.getByLabelText(/^From/) as HTMLInputElement).value).toBe('2026-10-01'),
      );
      expect((screen.getByLabelText(/^To/) as HTMLInputElement).value).toBe('2026-10-31');
    });

    it.each([
      ['This month', '?kind=utilization&from=2026-11-01&to=2026-12-01'],
      ['Last month', '?kind=utilization&from=2026-10-01&to=2026-11-01'],
      ['Last 30 days', '?kind=utilization&from=2026-10-17&to=2026-11-16'],
    ])('applies the quick range %s', async (name, search) => {
      serve();
      renderPage('?from=2025-01-01&to=2025-02-01');
      await screen.findByRole('table', { name: 'Utilization by variant' });
      fireEvent.click(screen.getByRole('button', { name }));
      await waitFor(() => expect(screen.getByTestId('search').textContent).toBe(search));
    });
  });

  describe('the CSV file', () => {
    let click: ReturnType<typeof vi.fn>;
    let created: Blob[];
    beforeEach(() => {
      click = vi.fn();
      created = [];
      vi.stubGlobal('URL', {
        createObjectURL: (blob: Blob) => {
          created.push(blob);
          return 'blob:test';
        },
        revokeObjectURL: vi.fn(),
      });
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(click);
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    it('saves the server file under the kind and the period', async () => {
      serve();
      renderPage('?kind=revenue&from=2026-10-01&to=2026-11-01');
      await screen.findByRole('table', { name: 'Revenue by variant' });
      fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
      expect(await screen.findByRole('button', { name: 'Downloaded' })).toBeTruthy();
      expect(reads()).toContain('/reports/revenue?from=2026-10-01&to=2026-11-01&format=csv');
      expect(click).toHaveBeenCalledTimes(1);
      expect(await created[0].text()).toBe('variant\n');
    });

    it('shows the failure beside the button with a Retry, and keeps the table', async () => {
      serve((endpoint) => {
        if (endpoint.includes('format=csv'))
          throw new ApiError(500, 'INTERNAL_ERROR', 'The file could not be made.');
        return { kind: 'revenue', from: '2026-11-01', to: '2026-12-01', rows: ROWS.revenue };
      });
      renderPage('?kind=revenue');
      await screen.findByRole('table', { name: 'Revenue by variant' });
      fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
      expect(await screen.findByText('The file could not be made.')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
      expect(screen.getByRole('table', { name: 'Revenue by variant' })).toBeTruthy();
      expect(click).not.toHaveBeenCalled();
    });
  });

  it('drops a CSV failure when the tab changes, so Retry never fetches the other tab', async () => {
    serve((endpoint) => {
      if (endpoint.includes('format=csv'))
        throw new ApiError(500, 'INTERNAL_ERROR', 'The file could not be made.');
      const kind = /\/reports\/([a-z-]+)/.exec(endpoint)?.[1] ?? '';
      return { kind, from: '2026-11-01', to: '2026-12-01', rows: ROWS[kind] ?? [] };
    });
    renderPage('?kind=revenue');
    await screen.findByRole('table', { name: 'Revenue by variant' });
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    await screen.findByText('The file could not be made.');
    fireEvent.click(tab('Overdue contracts'));
    await screen.findByRole('table', { name: 'Overdue contracts' });
    expect(screen.queryByText('The file could not be made.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('shows the row count and the time it was generated', async () => {
    serve();
    renderPage();
    await screen.findByRole('table', { name: 'Utilization by variant' });
    expect(screen.getByText(/^2 rows, generated \d\d:\d\d:\d\d$/)).toBeTruthy();
  });

  it('says so, and offers a longer range, when the period holds nothing', async () => {
    serve(() => ({ kind: 'overdue', from: '2026-11-01', to: '2026-12-01', rows: [] }));
    renderPage('?kind=overdue');
    expect((await screen.findAllByText('No results match your filters.')).length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByText('Try a longer range.').length).toBeGreaterThan(0);
    expect(screen.getByText(/^0 rows, generated/)).toBeTruthy();
  });

  it('shows the server message in a banner for a 400', async () => {
    serve(() => {
      throw new ApiError(
        400,
        'VALIDATION_FAILED',
        'to must be after from and at most 31 days later.',
      );
    });
    renderPage();
    expect(
      await screen.findByText('to must be after from and at most 31 days later.'),
    ).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('offers Try again for another failure', async () => {
    serve(() => {
      throw new ApiError(500, 'INTERNAL_ERROR', 'Something broke.');
    });
    renderPage();
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('shows MSG26 alone for a 403', async () => {
    serve(() => {
      throw new ApiError(403, 'FORBIDDEN', 'Forbidden');
    });
    renderPage();
    expect((await screen.findByRole('alert')).textContent).toBe('You do not have access to this.');
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('offers the report as a select on a phone, which follows the URL', async () => {
    serve();
    renderPage();
    await screen.findByRole('table', { name: 'Utilization by variant' });
    fireEvent.change(screen.getByLabelText('Report'), { target: { value: 'lost' } });
    await screen.findByRole('table', { name: 'Lost units' });
    expect(screen.getByTestId('search').textContent).toBe(
      '?kind=lost&from=2026-11-01&to=2026-12-01',
    );
  });

  it('keeps the chart behind a button for a phone', async () => {
    serve();
    renderPage();
    await screen.findByRole('table', { name: 'Utilization by variant' });
    const toggle = screen.getByRole('button', { name: 'Show chart' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Hide chart' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
  });
});
