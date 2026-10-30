// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StaffIncidentsPage } from './StaffIncidentsPage';

const api = vi.fn();
vi.mock('../shared/api/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/api/apiClient')>()),
  apiClient: (...args: unknown[]) => api(...args),
}));

const incident = (overrides: Record<string, unknown> = {}) => ({
  id: 'inc-1',
  code: 'INC-2026-000007',
  device: { id: 'd-1', assetTag: 'TL-0010', holder: null },
  organizationId: 'org-a',
  contractId: 'c-1',
  state: 'ESCALATED',
  stateChangedAt: '2026-11-01T03:20:00Z',
  source: 'DEVICE_SOS',
  confidence: 'CONFIRMED',
  firstEventAt: '2026-11-01T03:15:00Z',
  lastEventAt: '2026-11-01T03:15:30Z',
  eventCount: 2,
  lastPosition: null,
  stale: false,
  owner: null,
  tierDeadlineAt: null,
  statusDueAt: null,
  reopenCount: 0,
  version: 4,
  statusUpdates: [],
  authorityReports: [],
  ...overrides,
});

const page = (items: unknown[]) => ({
  items,
  pageNumber: 1,
  pageSize: 20,
  totalCount: items.length,
  totalPages: items.length > 0 ? 1 : 0,
});

const renderPage = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <StaffIncidentsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => api.mockReset());
afterEach(cleanup);

describe('StaffIncidentsPage (/t/incidents, screen 8.2)', () => {
  it('reads the unrouted and escalated queue by default, with the Staff disclaimer', async () => {
    api.mockResolvedValue(page([incident()]));
    renderPage();
    expect(await screen.findByText('INC-2026-000007')).toBeTruthy();
    expect(String(api.mock.calls[0][0])).toBe(
      '/incidents?pageSize=20&pageNumber=1&state=UNROUTED&state=ESCALATED',
    );
    expect(screen.getByText('TL-0010, No holder label')).toBeTruthy();
    expect(screen.getByText(/does not coordinate rescue operations/)).toBeTruthy();
  });

  it('switches to all incidents without a state filter, and shows the filtered empty state', async () => {
    api.mockResolvedValue(page([]));
    renderPage();
    expect(
      await screen.findByText('No unrouted or escalated incidents need attention.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'All incidents' }));
    expect(await screen.findByText('No results match your filters.')).toBeTruthy();
    expect(String(api.mock.calls[api.mock.calls.length - 1][0])).toBe(
      '/incidents?pageSize=20&pageNumber=1',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Escalated' }));
    await waitFor(() =>
      expect(String(api.mock.calls[api.mock.calls.length - 1][0])).toContain('state=ESCALATED'),
    );
  });

  it('opens the selected incident read-only, with a retained owner and no acknowledge action', async () => {
    api.mockImplementation((endpoint?: string) =>
      Promise.resolve(
        String(endpoint).startsWith('/incidents/inc-1')
          ? incident({
              owner: { id: 'u-op', fullName: 'Operator One' },
              device: {
                id: 'd-1',
                assetTag: 'TL-0010',
                holder: { name: 'Pham Van F', phone: '0912' },
              },
              lastPosition: { lat: 11.5544, lon: 108.5381 },
              statusUpdates: [
                {
                  id: 's-1',
                  note: 'On the way',
                  author: { id: 'u-op', fullName: null },
                  createdAt: '2026-11-01T03:18:00Z',
                },
              ],
            })
          : page([incident()]),
      ),
    );
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'INC-2026-000007' }));
    expect(await screen.findByText('Operator One')).toBeTruthy();
    expect(screen.getByText('Pham Van F, 0912')).toBeTruthy();
    expect(screen.getByText('11.55440, 108.53810')).toBeTruthy();
    expect(screen.getByText('On the way')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View contract' }).getAttribute('href')).toBe(
      '/t/contracts/c-1',
    );
    expect(screen.queryByRole('button', { name: 'Acknowledge' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to queue' }));
    expect(screen.queryByText('Operator One')).toBeNull();
  });

  it('shows the queue owner text when nobody owns the incident', async () => {
    api.mockImplementation((endpoint?: string) =>
      Promise.resolve(
        String(endpoint).startsWith('/incidents/inc-1') ? incident() : page([incident()]),
      ),
    );
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'INC-2026-000007' }));
    expect(await screen.findByText('TrekLink Staff queue')).toBeTruthy();
    expect(screen.getByText('Position unavailable')).toBeTruthy();
  });

  it('offers Report to authorities on an escalated incident only (screen 8.3)', async () => {
    let state = 'ESCALATED';
    api.mockImplementation((endpoint?: string) =>
      Promise.resolve(
        String(endpoint).startsWith('/incidents/inc-1') ? incident({ state }) : page([incident()]),
      ),
    );
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'INC-2026-000007' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Report to authorities' }));
    expect(await screen.findByText('Incident INC-2026-000007, Escalated')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to queue' }));
    state = 'ACKNOWLEDGED';
    fireEvent.click(await screen.findByRole('button', { name: 'INC-2026-000007' }));
    expect(await screen.findByText('No authority reports recorded.')).toBeTruthy();
    // The cached detail shows first; the refetch brings the new state.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Report to authorities' })).toBeNull(),
    );
  });

  it('switches to the Authority reports tab and back to the linked incident', async () => {
    api.mockImplementation((endpoint?: string) => {
      const url = String(endpoint);
      if (url.startsWith('/authority-reports'))
        return Promise.resolve(
          page([
            {
              id: 'ar-1',
              incidentId: 'inc-1',
              contractId: null,
              agency: 'Lam Dong rescue (114)',
              reference: 'LD-114-07',
              reportedAt: '2026-11-01T03:25:00Z',
              caseClosedAt: null,
            },
          ]),
        );
      if (url.startsWith('/incidents/inc-1'))
        return Promise.resolve(incident({ state: 'REPORTED' }));
      return Promise.resolve(page([incident()]));
    });
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: 'Authority reports' }));
    expect(await screen.findByText('LD-114-07')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'View incident' }));
    expect(await screen.findByRole('button', { name: 'Back to queue' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Incident queue' }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });
});
