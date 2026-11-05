// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LossCasesPage } from './LossCasesPage';

const api = vi.fn();
vi.mock('../shared/api/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/api/apiClient')>()),
  apiClient: (...args: unknown[]) => api(...args),
}));

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'lc-1',
  code: 'LOSS-0003',
  device: { id: 'dev-1', assetTag: 'TL-0042' },
  state: 'SETTLED',
  stateFromDevice: 'RENTED',
  reportedAt: '2026-10-20T03:15:00.000Z',
  description: 'Lost',
  lastSeenAt: null,
  lastPosition: null,
  custody: 'RENTER',
  contractDeviceId: 'cd-77',
  organization: { id: 'org-1', code: 'ORG-0007' },
  keyExposed: true,
  suspectedTheft: true,
  policeReference: 'CA-PD-2026-118',
  searchEndsAt: null,
  triagedById: 'staff-1',
  decision: 'REDUCED',
  chargeVnd: 900000,
  version: 3,
  ...overrides,
});

const page = (items: unknown[]) => ({
  items,
  pageNumber: 1,
  pageSize: 20,
  totalCount: items.length,
  totalPages: 1,
});

const renderPage = (scope: 't' | 'o') =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <LossCasesPage scope={scope} />
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  api.mockReset();
});
afterEach(cleanup);

describe('LossCasesPage (screen 4.4)', () => {
  it('lists the TrekLink view with organization, custody and a link to each case', async () => {
    api.mockResolvedValue(page([row()]));
    renderPage('t');
    const [link] = await screen.findAllByRole('link', { name: 'LOSS-0003' });
    expect(link.getAttribute('href')).toBe('/t/loss-cases/lc-1');
    expect(screen.getByText('ORG-0007')).toBeTruthy();
    expect(screen.getByText('Renter')).toBeTruthy();
    expect(api).toHaveBeenCalledWith('/loss-cases?pageNumber=1&pageSize=20');
  });

  it('shows the organization its cases read only, with the settlement and never the theft fields', async () => {
    api.mockResolvedValue(page([row()]));
    renderPage('o');
    expect((await screen.findAllByText('LOSS-0003')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: 'LOSS-0003' })).toBeNull();
    expect(screen.getAllByText('Reduced, 900,000 VND').length).toBeGreaterThan(0);
    expect(screen.queryByText('CA-PD-2026-118')).toBeNull();
    expect(screen.queryByText('Custody')).toBeNull();
  });

  // W26: the code, device, state and reported headers sort on the server (devices api-design 18).
  it('sends the header sort as sort and order, for the TrekLink and the organization view', async () => {
    api.mockResolvedValue(page([row(), row({ id: 'lc-2', code: 'LOSS-0004' }), row({ id: 'lc-3', code: 'LOSS-0005' })]));
    const lastGet = () => String(api.mock.calls[api.mock.calls.length - 1][0]);
    const header = async (name: string) =>
      within(await screen.findByRole('table', { name: 'Loss cases' })).getByRole('button', { name });
    renderPage('t');
    fireEvent.click(await header('Device'));
    await waitFor(() => expect(lastGet()).toBe('/loss-cases?pageNumber=1&pageSize=20&sort=assetTag&order=asc'));
    fireEvent.click(await header('Case'));
    await waitFor(() => expect(lastGet()).toBe('/loss-cases?pageNumber=1&pageSize=20&sort=code&order=asc'));
    // Reported is the default order: newest first sends no sort, oldest first is asked for.
    fireEvent.click(await header('Reported'));
    await waitFor(() => expect(lastGet()).toBe('/loss-cases?pageNumber=1&pageSize=20&sort=reportedAt&order=asc'));
    const sortable = within(await screen.findByRole('table', { name: 'Loss cases' }))
      .getAllByRole('columnheader')
      .filter((cell) => cell.querySelector('[data-sort-icon]'))
      .map((cell) => cell.textContent);
    expect(sortable).toEqual(['Case', 'Device', 'State', 'Reported']);
    cleanup();
    renderPage('o');
    fireEvent.click(await header('State'));
    await waitFor(() => expect(lastGet()).toBe('/loss-cases?pageNumber=1&pageSize=20&sort=state&order=asc'));
  });

  it('filters by state and says so when nothing matches (MSG01)', async () => {
    // Three cases unfiltered (one or two would hide the command bar, chapter 06 §9.3), none searching.
    api.mockImplementation((endpoint: string) =>
      Promise.resolve(
        endpoint.includes('state=')
          ? page([])
          : page([row(), row({ id: 'lc-2', code: 'LOSS-0004' }), row({ id: 'lc-3', code: 'LOSS-0005' })]),
      ),
    );
    renderPage('o');
    fireEvent.click(await screen.findByRole('button', { name: /^Show: All states/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Searching' }));
    expect(await screen.findByText('No results match your filters.')).toBeTruthy();
    expect(api).toHaveBeenLastCalledWith('/loss-cases?state=SEARCHING&pageNumber=1&pageSize=20');
  });
});
