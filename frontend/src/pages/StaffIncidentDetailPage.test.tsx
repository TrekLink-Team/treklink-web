// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StaffIncidentDetailPage } from './StaffIncidentDetailPage';
import { useSession, type SessionUser } from '../entities/session/model';
import { incidentKeys } from '../entities/incident/api';
import { ApiError } from '../shared/api/apiClient';

const api = vi.fn();
vi.mock('../shared/api/apiClient', async (original) => ({
  ...(await original<typeof import('../shared/api/apiClient')>()),
  apiClient: (...args: unknown[]) => api(...args),
}));

const incident = {
  id: 'inc-1',
  code: 'INC-2026-000007',
  device: { id: 'device-1', assetTag: 'TL-0010', holder: null },
  organizationId: 'org-1',
  contractId: 'contract-1',
  state: 'ESCALATED',
  source: 'DEVICE_SOS',
  confidence: 'CONFIRMED',
  stale: false,
  simulated: true,
  stateChangedAt: '2026-11-05T01:00:00Z',
  firstEventAt: '2026-11-05T00:00:00Z',
  lastEventAt: '2026-11-05T00:10:00Z',
  lastPosition: null,
  eventCount: 2,
  reopenCount: 0,
  owner: null,
  tierDeadlineAt: null,
  statusDueAt: null,
  version: 3,
  outcomeNote: null,
  statusUpdates: [],
  authorityReports: [],
};
const events = [
  { eventId: 'e1', kind: 'SOS', observedAt: null, latitude: null, longitude: null },
  {
    eventId: 'e2',
    kind: 'POSITION',
    observedAt: '2026-11-05T00:10:00Z',
    latitude: 11.5,
    longitude: 108.5,
  },
];
const transitions = [
  {
    seq: 1,
    fromState: null,
    toState: 'DETECTED',
    reason: 'CREATED',
    actor: 'SYSTEM',
    createdAt: '2026-11-05T00:00:00Z',
    note: null,
  },
  {
    seq: 2,
    fromState: 'DETECTED',
    toState: 'UNROUTED',
    reason: 'ROUTED',
    actor: 'SYSTEM',
    createdAt: '2026-11-05T00:00:01Z',
    note: 'Routing evidence',
  },
];
const alerts = [
  {
    kind: 'TRANSITION',
    tier: 'TREKLINK',
    recipient: null,
    channel: 'API_EVENT',
    status: 'PENDING',
    attempts: 0,
    sentAt: null,
    lastError: null,
  },
];
const response = (url: string) => {
  if (url === '/incidents/inc-1/events') return events;
  if (url === '/incidents/inc-1/transitions') return transitions;
  if (url === '/incidents/inc-1/alerts') return alerts;
  if (url === '/incidents/inc-1') return incident;
  throw new Error('Unexpected endpoint: ' + url);
};
const mount = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/t/incidents/inc-1']}>
        <Routes>
          <Route path="/t/incidents/:id" element={<StaffIncidentDetailPage />} />
          <Route path="/t/incidents" element={<p>Queue destination</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
};
beforeEach(() => {
  api.mockReset().mockImplementation((url: string) => Promise.resolve(response(url)));
  useSession.setState({ user: { roles: ['STAFF'] } as SessionUser });
});
afterEach(cleanup);

afterEach(() => vi.unstubAllGlobals());

describe('standalone Staff incident detail', () => {
  it('refreshes the existing detail query and shows upgraded confidence', async () => {
    let confidence = 'SUSPECTED';
    api.mockImplementation((url: string) =>
      Promise.resolve(url === '/incidents/inc-1' ? { ...incident, confidence } : response(url)),
    );
    mount();
    await screen.findByText('Suspected');
    confidence = 'CONFIRMED';
    fireEvent.click(screen.getByRole('button', { name: 'Refresh detail' }));
    await waitFor(() => expect(screen.queryByText('Suspected')).toBeNull());
    expect(api.mock.calls.filter(([url]) => url === '/incidents/inc-1')).toHaveLength(2);
  });

  it('saves a reviewed false alarm on the standalone page and retains the updated record', async () => {
    let state = 'UNROUTED';
    api.mockImplementation((url: string, options?: RequestInit) => {
      if (options?.method === 'POST') state = 'FALSE_ALARM';
      return Promise.resolve(
        url === '/incidents/inc-1' || options?.method === 'POST'
          ? { ...incident, state }
          : response(url),
      );
    });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Declare false alarm' }));
    fireEvent.change(screen.getByLabelText(/Reason/), {
      target: { value: 'Staff verified the test trigger.' },
    });
    fireEvent.submit(screen.getByLabelText(/Reason/).closest('form')!);
    await screen.findByText('False alarm');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('heading', { name: incident.code, level: 1 })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Declare false alarm' })).toBeNull();
  });

  it('uses the shared phone action bar with a reachable Back action', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    mount();
    await screen.findByRole('heading', { name: incident.code });
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Back to queue' }));
    expect(await screen.findByText('Queue destination')).toBeTruthy();
  });
  it('reuses the four existing queries, ordered evidence and Staff-only actions', async () => {
    mount();
    const title = await screen.findByRole('heading', { name: incident.code, level: 1 });
    expect(document.activeElement).toBe(title);
    expect(
      await screen.findByRole('heading', { name: 'Episode evidence (2 events)', level: 2 }),
    ).toBeTruthy();
    const trail = screen.getByRole('list', { name: 'Episode events, oldest first' });
    expect(trail.getAttribute('tabindex')).toBe('0');
    expect(within(trail).getAllByRole('listitem')[0].textContent).toContain(
      'SOS buttonTime unavailablePosition unavailable',
    );
    expect(within(trail).getAllByRole('listitem')[1].textContent).toContain('11.50000, 108.50000');
    expect(await screen.findByText('Routing evidence')).toBeTruthy();
    expect(await screen.findByText(/Organization API stream/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Report to authorities' })).toBeTruthy();
    for (const name of [
      'Acknowledge',
      'Response under way',
      'Resolve incident',
      'Add status',
      'Declare false alarm',
    ])
      expect(screen.queryByRole('button', { name })).toBeNull();
    expect(screen.getByRole('link', { name: 'View organization' }).getAttribute('href')).toBe(
      '/t/organizations/org-1',
    );
    for (const path of [
      '/incidents/inc-1',
      '/incidents/inc-1/events',
      '/incidents/inc-1/transitions',
      '/incidents/inc-1/alerts',
    ])
      expect(api.mock.calls.filter(([url]) => url === path)).toHaveLength(1);
    expect(api.mock.calls.some(([url]) => String(url).includes('/events?'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Back to queue' }));
    expect(await screen.findByText('Queue destination')).toBeTruthy();
  });

  it.each([403, 404])(
    'shows MSG26 without evidence when the main record returns %i',
    async (status) => {
      api.mockRejectedValue(new ApiError(status, 'NOT_FOUND', 'Private incident'));
      mount();
      expect(await screen.findByRole('alert')).toHaveProperty(
        'textContent',
        'You do not have access to this.',
      );
      expect(screen.queryByText(incident.code)).toBeNull();
      expect(api.mock.calls.filter(([url]) => String(url).endsWith('/events'))).toHaveLength(0);
      expect(screen.getByRole('link', { name: 'Back to queue' }).getAttribute('href')).toBe(
        '/t/incidents',
      );
    },
  );

  it('clears cached detail and panels if access is revoked during a refresh', async () => {
    const client = mount();
    await screen.findByText('Routing evidence');
    await screen.findByText(/Organization API stream/);
    api.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Unavailable'));
    await act(() => client.invalidateQueries({ queryKey: incidentKeys.detail('inc-1') }));
    await screen.findByText('You do not have access to this.');
    expect(screen.queryByText('Routing evidence')).toBeNull();
    expect(screen.queryByText(incident.code)).toBeNull();
    expect(client.getQueriesData({ queryKey: incidentKeys.detail('inc-1') })).toEqual([]);
  });

  it('keeps history visible while episode evidence fails, and retries just that query', async () => {
    let offline = true;
    api.mockImplementation((url: string) =>
      url.endsWith('/events') && offline
        ? Promise.reject(new Error('Episode connection lost'))
        : Promise.resolve(response(url)),
    );
    mount();
    await screen.findByRole('button', { name: 'Try again' });
    expect(await screen.findByText('Routing evidence')).toBeTruthy();
    offline = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('heading', { name: 'Episode evidence (2 events)' });
    expect(api.mock.calls.filter(([url]) => url === '/incidents/inc-1')).toHaveLength(1);
  });

  it('hides forbidden delivery evidence without hiding the incident or its history', async () => {
    api.mockImplementation((url: string) =>
      url.endsWith('/alerts')
        ? Promise.reject(new ApiError(403, 'FORBIDDEN', 'No delivery access'))
        : Promise.resolve(response(url)),
    );
    mount();
    await screen.findByText('Routing evidence');
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Alert deliveries' })).toBeNull(),
    );
    expect(screen.getByRole('heading', { name: incident.code })).toBeTruthy();
    expect(screen.queryByText('No delivery access')).toBeNull();
  });

  it('rechecks the main record after missing panel evidence and then conceals it if absent', async () => {
    let reads = 0;
    api.mockImplementation((url: string) => {
      if (url === '/incidents/inc-1' && ++reads > 1)
        return Promise.reject(new ApiError(404, 'NOT_FOUND', 'Unavailable'));
      if (url.endsWith('/events'))
        return Promise.reject(new ApiError(404, 'NOT_FOUND', 'Unavailable'));
      return Promise.resolve(response(url));
    });
    mount();
    await screen.findByText('You do not have access to this.');
    expect(reads).toBe(2);
    expect(screen.queryByText('Routing evidence')).toBeNull();
  });

  it('shows independent empty states and the recorded outcome for a closed incident', async () => {
    api.mockImplementation((url: string) =>
      Promise.resolve(
        url === '/incidents/inc-1'
          ? { ...incident, state: 'CLOSED', outcomeNote: 'Recorded safe outcome' }
          : [],
      ),
    );
    mount();
    expect(await screen.findByText('Recorded safe outcome')).toBeTruthy();
    await screen.findByText('No events recorded for this episode.');
    await screen.findByText('No history recorded.');
    await screen.findByText('No alerts sent for this incident.');
    expect(screen.queryByRole('button', { name: 'Report to authorities' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Declare false alarm' })).toBeNull();
  });

  it.each(['STAFF', 'ADMIN'])(
    'offers the existing UNROUTED false-alarm dialog to %s',
    async (role) => {
      useSession.setState({ user: { roles: [role] } as SessionUser });
      api.mockImplementation((url: string) =>
        Promise.resolve(
          url === '/incidents/inc-1' ? { ...incident, state: 'UNROUTED' } : response(url),
        ),
      );
      mount();
      fireEvent.click(await screen.findByRole('button', { name: 'Declare false alarm' }));
      expect(await screen.findByRole('dialog')).toBeTruthy();
      expect(screen.getByLabelText(/Reason/)).toBeTruthy();
    },
  );
});
