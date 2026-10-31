// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
    // The table and the phone cards both render; the first link is the table's.
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

  it('filters by state and says so when nothing matches (MSG01)', async () => {
    api.mockResolvedValue(page([]));
    renderPage('o');
    expect(await screen.findByText('Your organization has no loss cases.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('State'), { target: { value: 'SEARCHING' } });
    expect(await screen.findByText('No results match your filters.')).toBeTruthy();
    expect(api).toHaveBeenLastCalledWith('/loss-cases?state=SEARCHING&pageNumber=1&pageSize=20');
  });
});
