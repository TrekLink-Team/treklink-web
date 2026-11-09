// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, Route, RouterProvider, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '../app/providers/useAuth';
import { UnsavedChangesProvider } from '../app/providers/UnsavedChangesProvider';
import type { SessionUser } from '../entities/session/model';
import { ApiError } from '../shared/api/apiClient';
import { useToast } from '../shared/ui/toastStore';
import { IncidentDetailPage } from './IncidentDetailPage';
import { IncidentsPage, OrganizationIncidentsLayout } from './IncidentsPage';

const api = vi.fn();
const episodeApi = vi.fn();
vi.mock('../shared/api/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/api/apiClient')>()),
  apiClient: (...args: unknown[]) =>
    args[0] === '/groups'
      ? Promise.resolve({ groups: [], maxDepth: 3 })
      : String(args[0]).endsWith('/events')
        ? episodeApi(...args)
        : api(...args),
}));

const ME = { id: 'u-me', fullName: 'Me', roles: ['ORG_OPERATOR'] } as SessionUser;
const MANAGER = { id: 'u-mgr', fullName: 'Manager', roles: ['ORG_MANAGER'] } as SessionUser;

// api-design 12 and 14 rows.
const TRAIL = [
  {
    seq: 1,
    fromState: null,
    toState: 'DETECTED',
    actor: 'SYSTEM',
    reason: 'CREATED',
    note: null,
    createdAt: '2026-10-29T03:15:00Z',
  },
  {
    seq: 2,
    fromState: 'DETECTED',
    toState: 'NOTIFY_PRIMARY',
    actor: 'SYSTEM',
    reason: 'ROUTED',
    note: null,
    createdAt: '2026-10-29T03:15:00Z',
  },
  {
    seq: 3,
    fromState: 'NOTIFY_PRIMARY',
    toState: 'ACKNOWLEDGED',
    actor: 'Pham Van D',
    reason: 'SOME_NEW_CODE',
    note: 'Two rangers are on the north trail\nRadio check every 15 minutes',
    createdAt: '2026-10-29T03:16:00Z',
  },
];
const ALERTS = [
  {
    kind: 'TRANSITION',
    tier: 'PRIMARY',
    recipient: 'Pham Van D',
    channel: 'WEBSOCKET',
    status: 'SENT',
    attempts: 1,
    sentAt: '2026-10-29T03:15:01Z',
    lastError: null,
  },
  {
    kind: 'TRANSITION',
    tier: 'PRIMARY',
    recipient: null,
    channel: 'API_EVENT',
    status: 'PENDING',
    attempts: 0,
    sentAt: null,
    lastError: null,
  },
  {
    kind: 'TRANSITION',
    tier: 'MANAGER',
    recipient: 'Tran Van B',
    channel: 'EMAIL',
    status: 'FAILED',
    attempts: 5,
    sentAt: null,
    lastError: 'SMTP 451',
  },
];

const view = (overrides: Record<string, unknown> = {}) => ({
  id: 'inc-1',
  code: 'INC-2026-000001',
  device: { id: 'd-1', assetTag: 'TL-0042', holder: { name: 'Le Thi E', phone: '0912' } },
  organizationId: 'org-a',
  contractId: 'c-1',
  state: 'NOTIFY_PRIMARY',
  stateChangedAt: '2026-10-29T03:15:00Z',
  source: 'DEVICE_SOS',
  confidence: 'CONFIRMED',
  firstEventAt: '2026-10-29T03:15:00Z',
  lastEventAt: '2026-10-29T03:15:30Z',
  eventCount: 1,
  lastPosition: { lat: 11.5544, lon: 108.5381 },
  stale: false,
  owner: null,
  tierDeadlineAt: '2026-10-29T03:17:00Z',
  statusDueAt: null,
  reopenCount: 0,
  version: 1,
  outcomeNote: null,
  statusUpdates: [],
  authorityReports: [],
  ...overrides,
});

const page = (items: unknown[]) => ({
  items,
  pageNumber: 1,
  pageSize: 20,
  totalCount: items.length,
  totalPages: items.length > 0 ? 2 : 0,
});

const renderAt = (
  path: string,
  user: SessionUser = ME,
  previous?: string,
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) => {
  const router = createMemoryRouter(
    [{
      path: '*',
      element: (
        <UnsavedChangesProvider canBlock={() => true}>
          <Routes>
            <Route path="/o/incidents" element={<OrganizationIncidentsLayout />}>
              <Route index element={<IncidentsPage />} />
              <Route path=":id" element={<IncidentDetailPage />} />
            </Route>
            <Route path="/o/map" element={<p>Map destination</p>} />
          </Routes>
        </UnsavedChangesProvider>
      ),
    }],
    { initialEntries: previous ? [previous, path] : [path] },
  );
  render(
    <AuthContext.Provider value={{ user, signOut: vi.fn() }}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </AuthContext.Provider>,
  );
  return router;
};

const lastGet = () => String(api.mock.calls[api.mock.calls.length - 1][0]);

beforeEach(() => {
  api.mockReset();
  episodeApi.mockReset().mockResolvedValue([]);
  useToast.getState().dismiss();
});
afterEach(cleanup);

describe('IncidentsPage (/o/incidents, screen 8.1)', () => {
  it('validates and applies device/date filters, then restores the filtered page and scroll on Back', async () => {
    const device = '9c616d72-c291-4684-9d43-2032f58f5cbf';
    const localDate = '2026-11-04T14:15';
    api.mockImplementation((path: string) => {
      if (path.endsWith('/transitions')) return Promise.resolve([]);
      if (path === '/incidents/inc-1') return Promise.resolve(view());
      const params = new URL(path, 'https://example.test').searchParams;
      return Promise.resolve({
        ...page([view()]),
        totalCount: 22,
        pageNumber: Number(params.get('pageNumber') ?? 1),
      });
    });
    renderAt('/o/incidents');
    await screen.findByRole('table', { name: 'Incidents' });
    fireEvent.click(screen.getByRole('button', { name: 'Filter incidents' }));
    fireEvent.change(screen.getByLabelText('Device ID'), { target: { value: 'TL-0042' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    expect(screen.getByText('Enter a valid device UUID.')).toBeTruthy();
    expect(api).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText('Device ID'), { target: { value: device } });
    fireEvent.change(screen.getByLabelText('Created from'), { target: { value: localDate } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    await waitFor(() => {
      const params = new URL(lastGet(), 'https://example.test').searchParams;
      expect(params.get('deviceId')).toBe(device);
      expect(params.get('from')).toBe(new Date(localDate).toISOString());
      expect(params.get('pageNumber')).toBe('1');
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(lastGet()).toContain('pageNumber=2'));
    const scroller = (await screen.findByRole('table', { name: 'Incidents' })).parentElement!;
    scroller.scrollTop = 112;
    fireEvent.scroll(scroller);
    fireEvent.click(screen.getByRole('link', { name: 'INC-2026-000001' }));
    await screen.findByRole('heading', { name: 'INC-2026-000001' });
    fireEvent.click(screen.getByRole('link', { name: 'Back to incidents' }));
    const restored = (await screen.findByRole('table', { name: 'Incidents' })).parentElement!;
    expect(restored.scrollTop).toBe(112);
    expect(screen.getByRole('button', { name: 'Filter incidents (active)' })).toBeTruthy();
    expect(lastGet()).toContain('pageNumber=2');
    expect(lastGet()).toContain(`deviceId=${device}`);
  });

  it('opens on all incidents with labels, owners, deadlines and the SAR disclaimer', async () => {
    api.mockResolvedValue(
      page([
        view(),
        view({
          id: 'inc-2',
          code: 'INC-2026-000002',
          device: { id: 'd-2', assetTag: null, holder: null },
          state: 'RESPONDING',
          confidence: 'SUSPECTED',
          stale: true,
          owner: { id: 'u-2', fullName: 'Pham Van D' },
          tierDeadlineAt: null,
          statusDueAt: '2026-10-29T03:45:00Z',
        }),
        view({
          id: 'inc-3',
          code: 'INC-2026-000003',
          tierDeadlineAt: null,
          owner: { id: 'u-3', fullName: null },
        }),
      ]),
    );
    renderAt('/o/incidents');
    expect(await screen.findAllByText('INC-2026-000001')).not.toHaveLength(0);
    expect(lastGet()).toBe('/incidents?pageSize=20&pageNumber=1');
    expect(screen.getByRole('button', { name: /^Show: All states/ })).toBeTruthy();
    expect(screen.getByText(/does not replace official search-and-rescue/)).toBeTruthy();
    expect(screen.getAllByText('TL-0042, Le Thi E')).not.toHaveLength(0);
    expect(screen.getAllByText('Unknown device, No holder label')).not.toHaveLength(0);
    expect(screen.getAllByText('Suspected')).not.toHaveLength(0);
    expect(screen.getAllByText('Device silent')).not.toHaveLength(0);
    expect(screen.getAllByText('Pham Van D')).not.toHaveLength(0);
    expect(screen.getAllByText('Unclaimed')).not.toHaveLength(0);
    expect(screen.getAllByText(/^Acknowledge by /)).not.toHaveLength(0);
    expect(screen.getAllByText(/^Next update by /)).not.toHaveLength(0);
    expect(screen.getAllByText('No pending deadline')).not.toHaveLength(0);
  });

  // The Show filter of the command bar (chapter 06 §9.3): all, open, or one state.
  const show = (label: string) => {
    fireEvent.click(screen.getByRole('button', { name: /^Show: / }));
    fireEvent.click(screen.getByRole('menuitem', { name: label }));
  };

  it('filters by state and open from Show, pages and refreshes', async () => {
    api.mockResolvedValue(page([view()]));
    renderAt('/o/incidents');
    await screen.findAllByText('INC-2026-000001');
    // A state combines with the incident scope (review of treklink-web#350).
    show('Escalated');
    await waitFor(() => expect(lastGet()).toContain('state=ESCALATED'));
    expect(lastGet()).not.toContain('open=');
    show('Incidents: Open only');
    await waitFor(() => expect(lastGet()).toContain('open=true'));
    show('Incidents: Open or closed');
    await waitFor(() => expect(lastGet()).not.toContain('open='));
    expect(lastGet()).toContain('state=ESCALATED');
    show('All states');
    await waitFor(() => expect(lastGet()).not.toContain('state='));
    fireEvent.click(await screen.findByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(lastGet()).toContain('pageNumber=2'));
    show('Incidents: Open only');
    await waitFor(() => expect(lastGet()).toBe('/incidents?pageSize=20&open=true&pageNumber=1'));
    const calls = api.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(api.mock.calls.length).toBeGreaterThan(calls));
  });

  // W26: the headers sort on the server (api-design 01); without a sort the urgency order stays.
  it('sends the header sort to the list, returns to page 1, and ends on the default order', async () => {
    api.mockResolvedValue({ ...page([view()]), totalPages: 2, totalCount: 30 });
    renderAt('/o/incidents');
    await screen.findAllByText('INC-2026-000001');
    expect(lastGet()).not.toContain('sort=');
    fireEvent.click(await screen.findByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(lastGet()).toContain('pageNumber=2'));
    const header = async (name: string) =>
      within(await screen.findByRole('table')).getByRole('button', { name });
    fireEvent.click(await header('Latest event'));
    await waitFor(() => expect(lastGet()).toContain('sort=lastEventAt&order=asc&pageNumber=1'));
    fireEvent.click(await header('Latest event'));
    await waitFor(() => expect(lastGet()).toContain('sort=lastEventAt&order=desc'));
    fireEvent.click(await header('Latest event'));
    await waitFor(() => expect(lastGet()).toBe('/incidents?pageSize=20&pageNumber=1'));
    fireEvent.click(await header('Incident'));
    await waitFor(() => expect(lastGet()).toContain('sort=code&order=asc'));
    const sortable = within(await screen.findByRole('table'))
      .getAllByRole('columnheader')
      .filter((cell) => cell.querySelector('[data-sort-icon]'))
      .map((cell) => cell.textContent);
    expect(sortable).toEqual(['Incident', 'State', 'Latest event']);
  });

  it('shows the empty states, unfiltered and filtered', async () => {
    api.mockResolvedValue(page([]));
    renderAt('/o/incidents');
    expect(await screen.findByText('No incidents recorded.')).toBeTruthy();
    show('Escalated');
    expect(await screen.findByText('No results match your filters.')).toBeTruthy();
    // Clearing drops both filters and restores every incident, open or closed.
    fireEvent.click(screen.getByRole('button', { name: 'Clear search and filter' }));
    await waitFor(() => expect(lastGet()).toBe('/incidents?pageSize=20&pageNumber=1'));
  });

  it('shows MSG26 with a retry when the list fails', async () => {
    api.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'You do not have access to this.'));
    renderAt('/o/incidents');
    expect(await screen.findByText('You do not have access to this.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(api.mock.calls.length).toBeGreaterThan(1));
  });
});

describe('IncidentDetailPage (/o/incidents/:id, screen 8.1)', () => {
  // Answers by endpoint: the trail and the alert log are their own GETs (api-design 12 and 14).
  const detail = (
    overrides: Record<string, unknown> = {},
    panels: { trail?: () => Promise<unknown>; alerts?: () => Promise<unknown> } = {},
  ) => {
    api.mockImplementation((endpoint: string, options?: RequestInit) => {
      if (options?.method === 'POST') return Promise.resolve(view());
      if (endpoint.endsWith('/transitions'))
        return panels.trail ? panels.trail() : Promise.resolve(TRAIL);
      if (endpoint.endsWith('/alerts'))
        return panels.alerts ? panels.alerts() : Promise.resolve(ALERTS);
      return Promise.resolve(view(overrides));
    });
  };
  const gets = (endpoint: string) =>
    api.mock.calls.filter(([called]) => called === endpoint).length;
  const posted = () =>
    api.mock.calls
      .filter(([, options]) => (options as RequestInit | undefined)?.method === 'POST')
      .map(([endpoint, options]) => [endpoint, JSON.parse(String((options as RequestInit).body))]);

  it('renders the ordered API 13 trail in the organization workspace without reading manager deliveries', async () => {
    detail();
    episodeApi.mockResolvedValue([
      { eventId: 'first', kind: 'SOS', observedAt: null, latitude: null, longitude: null },
      { eventId: 'second', kind: 'POSITION', observedAt: '2026-11-04T13:00:00Z', latitude: 11.5, longitude: 108.5 },
    ]);
    renderAt('/o/incidents/inc-1');
    const trail = await screen.findByRole('list', { name: 'Episode events, oldest first' });
    expect(within(trail).getAllByRole('listitem').map((row) => row.querySelector('p')?.textContent))
      .toEqual(['SOS button', 'Position']);
    expect(screen.getByRole('link', { name: 'Open map' }).getAttribute('href')).toBe('/o/map');
    expect(episodeApi).toHaveBeenCalledWith('/incidents/inc-1/events');
    expect(gets('/incidents/inc-1/alerts')).toBe(0);
  });

  it('keeps an incident draft on browser Back and route changes until discard is confirmed', async () => {
    detail();
    const router = renderAt('/o/incidents/inc-1', ME, '/o/map');
    fireEvent.click(await screen.findByRole('button', { name: 'Declare false alarm' }));
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Draft reason' } });
    const unload = () => window.dispatchEvent(new Event('beforeunload', { cancelable: true }));
    expect(unload()).toBe(false);
    await act(async () => { await router.navigate(-1); });
    const prompt = await screen.findByRole('dialog', { name: 'Discard unsaved changes?' });
    expect(document.activeElement).toBe(within(prompt).getByRole('button', { name: 'Keep editing' }));
    fireEvent.click(within(prompt).getByRole('button', { name: 'Keep editing' }));
    expect(router.state.location.pathname).toBe('/o/incidents/inc-1');
    expect((screen.getByLabelText(/Reason/) as HTMLTextAreaElement).value).toBe('Draft reason');
    fireEvent.click(screen.getByRole('link', { name: 'Open map' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard and leave' }));
    expect(await screen.findByText('Map destination')).toBeTruthy();
    expect(unload()).toBe(true);
    expect(posted()).toEqual([]);
  });

  it.each([
    ['network loss', new TypeError('Failed to fetch')],
    ['server failure', new ApiError(500, 'INTERNAL_ERROR', 'Read unavailable')],
  ])('warns about cached data after %s and retries without losing the draft', async (_name, failure) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let failed = false;
    api.mockImplementation((endpoint: string) => {
      if (endpoint.endsWith('/transitions')) return Promise.resolve(TRAIL);
      return failed
        ? Promise.reject(failure)
        : Promise.resolve(view({ state: 'ACKNOWLEDGED', owner: ME }));
    });
    renderAt('/o/incidents/inc-1', ME, undefined, client);
    fireEvent.click(await screen.findByRole('button', { name: 'Response under way' }));
    const draft = screen.getByLabelText(/What is being done/);
    fireEvent.change(draft, { target: { value: 'Keep this response draft' } });
    failed = true;
    await act(() => client.invalidateQueries({ queryKey: ['incident', 'inc-1'], exact: true }));
    expect(screen.getByRole('heading', { name: 'INC-2026-000001' })).toBeTruthy();
    expect((draft as HTMLTextAreaElement).value).toBe('Keep this response draft');
    expect(await screen.findByText('These incident details may be out of date.')).toBeTruthy();
    const notice = screen.getByRole('alert');
    expect(within(notice).getByRole('button', { name: 'Try again' })).toBeTruthy();
    const reads = gets('/incidents/inc-1');
    failed = false;
    fireEvent.click(within(notice).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(gets('/incidents/inc-1')).toBe(reads + 1));
    await waitFor(() => expect(screen.queryByText('These incident details may be out of date.')).toBeNull());
    expect((draft as HTMLTextAreaElement).value).toBe('Keep this response draft');
    expect(posted()).toEqual([]);
  });

  it.each([403, 404])('clears cached incident evidence after access changes to %s', async (status) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    detail();
    renderAt('/o/incidents/inc-1', ME, undefined, client);
    await screen.findByRole('heading', { name: 'INC-2026-000001' });
    api.mockRejectedValue(new ApiError(status, 'NOT_FOUND', 'Private record'));
    await act(() => client.invalidateQueries({ queryKey: ['incident', 'inc-1'], exact: true }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'You do not have access to this.Try again');
    expect(screen.queryByRole('heading', { name: 'INC-2026-000001' })).toBeNull();
    expect(screen.queryByRole('list', { name: 'Episode events, oldest first' })).toBeNull();
    expect(screen.queryByText('These incident details may be out of date.')).toBeNull();
  });

  it('shows the summary, the evidence lists and the notifying actions', async () => {
    detail({
      device: { id: 'd-1', assetTag: 'TL-0042', holder: { name: 'Le Thi E', phone: null } },
      reopenCount: 2,
      statusUpdates: [
        {
          id: 'su-1',
          note: 'Reached the holder',
          author: { id: 'u-2', fullName: null },
          createdAt: '2026-10-29T03:20:00Z',
        },
      ],
      authorityReports: [
        {
          id: 'ar-1',
          agency: 'Lam Dong 114',
          reference: 'LD-1',
          reportedAt: '2026-10-29T03:30:00Z',
          caseClosedAt: null,
        },
        {
          id: 'ar-2',
          agency: 'Lam Dong 115',
          reference: 'LD-2',
          reportedAt: '2026-10-29T03:31:00Z',
          caseClosedAt: '2026-10-29T05:00:00Z',
        },
      ],
    });
    renderAt('/o/incidents/inc-1');
    expect(await screen.findByRole('heading', { name: 'INC-2026-000001' })).toBeTruthy();
    expect(gets('/incidents/inc-1')).toBe(1);
    expect(screen.getByText('Le Thi E')).toBeTruthy();
    expect(screen.getByText('1, reopened 2 times')).toBeTruthy();
    expect(screen.getByText('11.55440, 108.53810')).toBeTruthy();
    expect(screen.getByText('SOS button')).toBeTruthy();
    expect(screen.getByText('Reached the holder')).toBeTruthy();
    expect(screen.getByText(/^A member, /)).toBeTruthy();
    expect(screen.getByText(/Lam Dong 114, LD-1, reported .*, open/)).toBeTruthy();
    expect(screen.getByText(/Lam Dong 115, LD-2, reported .*, closed /)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Acknowledge' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Declare false alarm' })).toBeTruthy();
  });

  // W15 panel walk: axe flagged definition-list and dlitem (serious) once an incident had an outcome,
  // because the Outcome fact sat in an extra div inside the <dl> (e2e/a11y.spec.ts allowlist).
  it('keeps the Outcome fact a direct dt and dd group of the facts list', async () => {
    detail({ state: 'RESOLVED', outcomeNote: 'Hiker found, walked out' });
    renderAt('/o/incidents/inc-1');
    const outcome = await screen.findByText('Hiker found, walked out');
    const list = outcome.closest('dl') as HTMLElement;
    for (const group of Array.from(list.children)) {
      expect(group.tagName).toBe('DIV');
      expect(Array.from(group.children).map((child) => child.tagName)).toEqual(['DT', 'DD']);
    }
    expect(outcome.closest('dd')?.parentElement?.parentElement).toBe(list);
  });

  it('shows the empty evidence and missing labels', async () => {
    detail({
      device: { id: 'd-1', assetTag: null, holder: null },
      lastPosition: null,
      state: 'CLOSED',
    });
    renderAt('/o/incidents/inc-1');
    expect(await screen.findByText('No holder label')).toBeTruthy();
    expect(screen.getByText('Unknown device')).toBeTruthy();
    expect(screen.getByText('Position unavailable')).toBeTruthy();
    expect(screen.getByText('No status updates recorded.')).toBeTruthy();
    expect(screen.getByText('No authority reports recorded.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Acknowledge' })).toBeNull();
  });

  it('acknowledges in one tap with the version and shows MSG03', async () => {
    detail();
    renderAt('/o/incidents/inc-1');
    fireEvent.click(await screen.findByRole('button', { name: 'Acknowledge' }));
    await waitFor(() => expect(useToast.getState().message).toBe('Saved.'));
    expect(posted()).toEqual([['/incidents/inc-1/acknowledge', { expectedVersion: 1 }]]);
  });

  it('shows MSG27 when another member acknowledged first, and MSG28 for a state change', async () => {
    detail();
    renderAt('/o/incidents/inc-1');
    api.mockImplementationOnce(() =>
      Promise.reject(new ApiError(409, 'ALREADY_OWNED', 'Pham Van D took this incident at 10:15.')),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Acknowledge' }));
    expect(await screen.findByText('Pham Van D took this incident at 10:15.')).toBeTruthy();
    api.mockImplementationOnce(() =>
      Promise.reject(new ApiError(409, 'INVALID_STATE_TRANSITION', 'not allowed')),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));
    expect(
      await screen.findByText('This cannot be done while it is Notifying primary.'),
    ).toBeTruthy();
  });

  it.each([
    [
      'Response under way',
      'What is being done',
      'Save response',
      '/incidents/inc-1/responding',
      { expectedVersion: 1, note: 'Team out' },
    ],
    [
      'Add status',
      'Status update',
      'Save status',
      '/incidents/inc-1/status-updates',
      { note: 'Team out' },
    ],
    [
      'Report outcome',
      'Outcome',
      'Resolve incident',
      '/incidents/inc-1/resolve',
      { expectedVersion: 1, outcomeNote: 'Team out' },
    ],
  ])(
    'lets the owner submit "%s" and shows MSG03',
    async (button, _field, submit, endpoint, body) => {
      detail({ state: 'ACKNOWLEDGED', owner: { id: 'u-me', fullName: 'Me' } });
      renderAt('/o/incidents/inc-1');
      fireEvent.click(await screen.findByRole('button', { name: button }));
      fireEvent.click(screen.getByRole('button', { name: submit }));
      expect(await screen.findByText('Please fill in this field.')).toBeTruthy();
      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: '  Team out ' },
      });
      fireEvent.click(screen.getByRole('button', { name: submit }));
      await waitFor(() => expect(useToast.getState().message).toBe('Saved.'));
      expect(posted()).toEqual([[endpoint, body]]);
    },
  );

  it('asks for a reason, names the incident and device, and declares a false alarm', async () => {
    detail();
    renderAt('/o/incidents/inc-1');
    fireEvent.click(await screen.findByRole('button', { name: 'Declare false alarm' }));
    expect(screen.getByText('Declare INC-2026-000001 (TL-0042) a false alarm?')).toBeTruthy();
    const form = screen.getByRole('form');
    fireEvent.change(within(form).getByLabelText(/Reason/), {
      target: { value: 'Pressed by mistake' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Declare false alarm' }));
    await waitFor(() =>
      expect(posted()).toEqual([
        ['/incidents/inc-1/false-alarm', { expectedVersion: 1, reason: 'Pressed by mistake' }],
      ]),
    );
  });

  it('keeps the draft and shows the error when a submit fails, and cancels', async () => {
    detail({
      state: 'RESPONDING',
      owner: { id: 'u-me', fullName: 'Me' },
      device: { id: 'd-1', assetTag: null, holder: null },
    });
    renderAt('/o/incidents/inc-1');
    fireEvent.click(await screen.findByRole('button', { name: 'Report outcome' }));
    expect(
      screen.getByText('Resolve INC-2026-000001? A new SOS may reopen this incident.'),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Outcome/), { target: { value: 'Done' } });
    api.mockImplementationOnce(() =>
      Promise.reject(
        new ApiError(
          409,
          'STALE_VERSION',
          'This was changed by someone else. Reload and try again.',
        ),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Resolve incident' }));
    expect(
      await screen.findByText('This was changed by someone else. Reload and try again.'),
    ).toBeTruthy();
    expect((screen.getByLabelText(/Outcome/) as HTMLTextAreaElement).value).toBe('Done');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect((screen.getByLabelText(/Outcome/) as HTMLTextAreaElement).value).toBe('Done');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByRole('button', { name: 'Add status' })).toBeTruthy();
  });

  it('tells another member who owns the response, and offers only the false alarm', async () => {
    detail({ state: 'RESPONDING', owner: { id: 'u-2', fullName: null } });
    renderAt('/o/incidents/inc-1');
    expect(await screen.findByText('Another member owns the response.')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Declare false alarm' })).toHaveLength(1);
  });

  it('names the owner for another member', async () => {
    detail({ state: 'ACKNOWLEDGED', owner: { id: 'u-2', fullName: 'Pham Van D' } });
    renderAt('/o/incidents/inc-1');
    expect(await screen.findByText('Pham Van D owns the response.')).toBeTruthy();
  });

  // Dry run defect 15: status updates are append-only, so a correction is a new update.
  const ORIGINAL = {
    id: 'su-1',
    note: 'At the ridge',
    author: { id: 'u-me', fullName: 'Me' },
    createdAt: '2026-10-29T03:20:00Z',
    correctsId: null,
    correctedById: null,
  };

  it('lets the owner correct an update, prefilled, posting a new one with correctsId', async () => {
    detail({
      state: 'RESPONDING',
      owner: { id: 'u-me', fullName: 'Me' },
      statusUpdates: [ORIGINAL],
    });
    renderAt('/o/incidents/inc-1');
    fireEvent.click(await screen.findByRole('button', { name: /^Correct the update of / }));
    const form = screen.getByRole('form', { name: 'Correct status' });
    const box = within(form).getByRole('textbox') as HTMLTextAreaElement;
    expect(box.value).toBe('At the ridge');
    fireEvent.change(box, { target: { value: 'At the second ridge' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save correction' }));
    await waitFor(() => expect(useToast.getState().message).toBe('Saved.'));
    expect(posted()).toEqual([
      ['/incidents/inc-1/status-updates', { note: 'At the second ridge', correctsId: 'su-1' }],
    ]);
  });

  it('marks the corrected update, names the correction, and offers no second correction', async () => {
    detail({
      state: 'RESPONDING',
      owner: { id: 'u-me', fullName: 'Me' },
      statusUpdates: [
        {
          ...ORIGINAL,
          id: 'su-2',
          note: 'At the second ridge',
          createdAt: '2026-10-29T03:25:00Z',
          correctsId: 'su-1',
        },
        { ...ORIGINAL, correctedById: 'su-2' },
      ],
    });
    renderAt('/o/incidents/inc-1');
    expect(await screen.findByText('Corrected')).toBeTruthy();
    expect(screen.getByText(/^Correction of /)).toBeTruthy();
    // Only the correction can still be corrected.
    expect(screen.getAllByRole('button', { name: /^Correct the update of / })).toHaveLength(1);
  });

  it('labels a correction whose original is absent without inventing an original timestamp', async () => {
    detail({ statusUpdates: [{ ...ORIGINAL, correctsId: 'unavailable-original' }] });
    renderAt('/o/incidents/inc-1');
    expect(await screen.findByText('Correction', { exact: true })).toBeTruthy();
    expect(screen.queryByText(/^Correction of /)).toBeNull();
  });

  it('offers Correct only to a member who may add a status', async () => {
    detail({
      state: 'RESPONDING',
      owner: { id: 'u-2', fullName: 'Pham Van D' },
      statusUpdates: [ORIGINAL],
    });
    renderAt('/o/incidents/inc-1');
    expect(await screen.findByText('At the ridge')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Correct the update of / })).toBeNull();
  });

  it('shows MSG26 and a way back when the incident cannot be read', async () => {
    api.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Incident not found.'));
    renderAt('/o/incidents/inc-9');
    expect(await screen.findByText('You do not have access to this.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to incidents' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(api.mock.calls.length).toBeGreaterThan(1));
  });

  it('shows the transition trail in order, with SYSTEM and unknown reason codes as sent (api-design 12)', async () => {
    detail();
    renderAt('/o/incidents/inc-1');
    const trail = await screen.findByRole('region', { name: 'History' });
    expect(await within(trail).findByText('Created as Detected')).toBeTruthy();
    const rows = within(trail).getAllByRole('listitem');
    expect(rows.map((row) => row.firstChild?.textContent)).toEqual([
      'Created as Detected',
      'Detected to Notifying primary',
      'Notifying primary to Acknowledged',
    ]);
    expect(within(rows[1]).getByText(/^Routed, by the system, /)).toBeTruthy();
    expect(within(rows[2]).getByText(/^SOME_NEW_CODE, by Pham Van D, /)).toBeTruthy();
    expect(gets('/incidents/inc-1/transitions')).toBe(1);
  });

  it('prints the saved note under its history row and keeps its line breaks', async () => {
    detail();
    renderAt('/o/incidents/inc-1');
    const trail = await screen.findByRole('region', { name: 'History' });
    await within(trail).findByText('Created as Detected');
    const rows = within(trail).getAllByRole('listitem');
    // A step with no note prints no extra paragraph: the heading line and the reason line only.
    expect(rows[0].querySelectorAll('p')).toHaveLength(2);
    const note = rows[2].querySelectorAll('p')[2];
    expect(note.textContent).toBe(
      'Two rangers are on the north trail\nRadio check every 15 minutes',
    );
    expect(note.className).toContain('whitespace-pre-wrap');
  });

  it('shows the outcome in the facts card once the incident is resolved', async () => {
    detail({ state: 'RESOLVED', outcomeNote: 'Holder walked down\nNo evacuation needed' });
    renderAt('/o/incidents/inc-1');
    const label = await screen.findByText('Outcome', { selector: 'dt' });
    const outcome = label.parentElement?.querySelector('dd');
    expect(outcome?.textContent).toBe('Holder walked down\nNo evacuation needed');
    expect(outcome?.querySelector('span')?.className).toContain('whitespace-pre-wrap');
  });

  it('shows no outcome fact while the incident is unresolved', async () => {
    detail();
    renderAt('/o/incidents/inc-1');
    await screen.findByText('Device');
    expect(screen.queryByText('Outcome', { selector: 'dt' })).toBeNull();
  });

  it('never requests or shows the alert log to an Org Operator', async () => {
    detail();
    renderAt('/o/incidents/inc-1');
    await screen.findByRole('region', { name: 'History' });
    expect(screen.queryByRole('region', { name: 'Alert deliveries' })).toBeNull();
    expect(gets('/incidents/inc-1/alerts')).toBe(0);
  });

  it('shows an Org Manager the alert log with its outcomes and a Refresh (api-design 14)', async () => {
    detail();
    renderAt('/o/incidents/inc-1', MANAGER);
    const log = await screen.findByRole('region', { name: 'Alert deliveries' });
    expect(await within(log).findByText(/^PRIMARY, Pham Van D, Live alert/)).toBeTruthy();
    expect(within(log).getByText(/^PRIMARY, Organization API stream, API event/)).toBeTruthy();
    expect(within(log).getByText(/^MANAGER, Tran Van B, Email/)).toBeTruthy();
    expect(within(log).getByText('Sent')).toBeTruthy();
    expect(within(log).getByText('Pending')).toBeTruthy();
    expect(within(log).getByText('Failed')).toBeTruthy();
    expect(within(log).getByText(/^1 attempt, sent /)).toBeTruthy();
    expect(within(log).getByText('0 attempts')).toBeTruthy();
    expect(within(log).getByText('5 attempts, last error: SMTP 451')).toBeTruthy();
    expect(within(log).getByText(/does not undo the incident's state change/)).toBeTruthy();
    fireEvent.click(within(log).getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(gets('/incidents/inc-1/alerts')).toBe(2));
  });

  it('names a device-silent delivery in the alert log (MSG40)', async () => {
    detail({}, { alerts: () => Promise.resolve([{ ...ALERTS[0], kind: 'STALE', tier: 'OWNER' }]) });
    renderAt('/o/incidents/inc-1', MANAGER);
    const log = await screen.findByRole('region', { name: 'Alert deliveries' });
    expect(
      await within(log).findByText(/^Device silent, OWNER, Pham Van D, Live alert/),
    ).toBeTruthy();
  });

  it('shows the empty trail and the empty alert log', async () => {
    detail({}, { trail: () => Promise.resolve([]), alerts: () => Promise.resolve([]) });
    renderAt('/o/incidents/inc-1', MANAGER);
    expect(await screen.findByText('No history recorded.')).toBeTruthy();
    expect(await screen.findByText('No alerts sent for this incident.')).toBeTruthy();
  });

  it('hides a panel the caller may not read and keeps the rest of the page', async () => {
    const forbidden = () =>
      Promise.reject(new ApiError(403, 'FORBIDDEN', 'You do not have access to this.'));
    detail({}, { trail: forbidden, alerts: forbidden });
    renderAt('/o/incidents/inc-1', MANAGER);
    await screen.findByRole('heading', { name: 'INC-2026-000001' });
    await waitFor(() => expect(gets('/incidents/inc-1/alerts')).toBe(1));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'History' })).toBeNull());
    expect(screen.queryByRole('region', { name: 'Alert deliveries' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Acknowledge' })).toBeTruthy();
  });

  it('retries the alert log in place after a failure', async () => {
    let fail = true;
    detail(
      {},
      {
        alerts: () =>
          fail
            ? Promise.reject(new ApiError(500, 'INTERNAL_ERROR', 'Something broke.'))
            : Promise.resolve(ALERTS),
      },
    );
    renderAt('/o/incidents/inc-1', MANAGER);
    const log = await screen.findByRole('region', { name: 'Alert deliveries' });
    expect(await within(log).findByText('Something broke.')).toBeTruthy();
    fail = false;
    fireEvent.click(within(log).getByRole('button', { name: 'Try again' }));
    expect(await within(log).findByText('Sent')).toBeTruthy();
  });

  it('rechecks the main record when a panel answers 404', async () => {
    detail(
      {},
      { trail: () => Promise.reject(new ApiError(404, 'NOT_FOUND', 'Incident not found.')) },
    );
    renderAt('/o/incidents/inc-1');
    await screen.findByRole('heading', { name: 'INC-2026-000001' });
    await waitFor(() => expect(gets('/incidents/inc-1')).toBe(2));
    expect(screen.queryByRole('region', { name: 'History' })).toBeNull();
  });

  it('offers a retry inside the panel for any other failure', async () => {
    let fail = true;
    detail(
      {},
      {
        trail: () =>
          fail
            ? Promise.reject(new ApiError(500, 'INTERNAL_ERROR', 'Something broke.'))
            : Promise.resolve(TRAIL),
      },
    );
    renderAt('/o/incidents/inc-1');
    const trail = await screen.findByRole('region', { name: 'History' });
    expect(await within(trail).findByText('Something broke.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Acknowledge' })).toBeTruthy();
    fail = false;
    fireEvent.click(within(trail).getByRole('button', { name: 'Try again' }));
    expect(await within(trail).findByText('Created as Detected')).toBeTruthy();
  });
});

// Below 600 px (chapter 06 §10.5, handoff item 7): a matchMedia that answers for a 360 px window.
describe('IncidentDetailPage when the incident cannot be read (review of treklink-web#355)', () => {
  it('keeps one h1 and a 24 px Back link', async () => {
    api.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'You do not have access to this.'));
    renderAt('/o/incidents/inc-1');
    expect(await screen.findByText('You do not have access to this.')).toBeTruthy();
    expect(
      screen.getAllByRole('heading', { level: 1 }).map((heading) => heading.textContent),
    ).toEqual(['Incident']);
    expect(screen.getByRole('link', { name: 'Back to incidents' }).className).toContain('min-h-6');
  });
});

describe('IncidentDetailPage at 360 px', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0) <= 360,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    api.mockImplementation((endpoint: string) => {
      if (endpoint.endsWith('/transitions')) return Promise.resolve(TRAIL);
      if (endpoint.endsWith('/alerts')) return Promise.resolve(ALERTS);
      return Promise.resolve(view());
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('pins Acknowledge to the bottom, widest, with the false alarm under More actions', async () => {
    renderAt('/o/incidents/inc-1');
    await screen.findByRole('heading', { name: 'INC-2026-000001' });
    const bar = screen.getByRole('group', { name: 'Incident actions' });
    expect(bar.hasAttribute('data-page-actions')).toBe(true);
    expect(within(bar).getByRole('button', { name: 'Acknowledge' }).className).toContain('flex-1');
    fireEvent.click(within(bar).getByRole('button', { name: /^More actions/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Declare false alarm' }));
    // The form opens in the page and the bar leaves until it is done.
    expect(screen.getByText('Declare INC-2026-000001 (TL-0042) a false alarm?')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Incident actions' })).toBeNull();
  });
});
