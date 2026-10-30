// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '../app/providers/useAuth';
import type { SessionUser } from '../entities/session/model';
import { ApiError } from '../shared/api/apiClient';
import { useToast } from '../shared/ui/toastStore';
import { IncidentDetailPage } from './IncidentDetailPage';
import { IncidentsPage } from './IncidentsPage';

const api = vi.fn();
vi.mock('../shared/api/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/api/apiClient')>()),
  apiClient: (...args: unknown[]) => api(...args),
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
    createdAt: '2026-10-29T03:15:00Z',
  },
  {
    seq: 2,
    fromState: 'DETECTED',
    toState: 'NOTIFY_PRIMARY',
    actor: 'SYSTEM',
    reason: 'ROUTED',
    createdAt: '2026-10-29T03:15:00Z',
  },
  {
    seq: 3,
    fromState: 'NOTIFY_PRIMARY',
    toState: 'ACKNOWLEDGED',
    actor: 'Pham Van D',
    reason: 'SOME_NEW_CODE',
    createdAt: '2026-10-29T03:16:00Z',
  },
];
const ALERTS = [
  {
    tier: 'PRIMARY',
    recipient: 'Pham Van D',
    channel: 'WEBSOCKET',
    status: 'SENT',
    attempts: 1,
    sentAt: '2026-10-29T03:15:01Z',
    lastError: null,
  },
  {
    tier: 'PRIMARY',
    recipient: null,
    channel: 'API_EVENT',
    status: 'PENDING',
    attempts: 0,
    sentAt: null,
    lastError: null,
  },
  {
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

const renderAt = (path: string, user: SessionUser = ME) =>
  render(
    <AuthContext.Provider value={{ user, signOut: vi.fn() }}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/o/incidents" element={<IncidentsPage />} />
            <Route path="/o/incidents/:id" element={<IncidentDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </AuthContext.Provider>,
  );

const lastGet = () => String(api.mock.calls[api.mock.calls.length - 1][0]);

beforeEach(() => {
  api.mockReset();
  useToast.getState().dismiss();
});
afterEach(cleanup);

describe('IncidentsPage (/o/incidents, screen 8.1)', () => {
  it('lists open incidents with labels, owners and deadlines, and the SAR disclaimer', async () => {
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
    expect(lastGet()).toBe('/incidents?pageSize=20&open=true&pageNumber=1');
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

  it('filters by state and open, pages, resets and refreshes', async () => {
    api.mockResolvedValue(page([view()]));
    renderAt('/o/incidents');
    await screen.findAllByText('INC-2026-000001');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ESCALATED' } });
    await waitFor(() => expect(lastGet()).toContain('state=ESCALATED'));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } });
    await waitFor(() => expect(lastGet()).not.toContain('state='));
    fireEvent.click(screen.getByLabelText('Open incidents only'));
    await waitFor(() => expect(lastGet()).not.toContain('open='));
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    await waitFor(() => expect(lastGet()).toContain('pageNumber=2'));
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(lastGet()).toBe('/incidents?pageSize=20&open=true&pageNumber=1'));
    const calls = api.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(api.mock.calls.length).toBeGreaterThan(calls));
  });

  it('shows the empty states, unfiltered and filtered', async () => {
    api.mockResolvedValue(page([]));
    renderAt('/o/incidents');
    expect(await screen.findByText('No open incidents.')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Open incidents only'));
    expect(await screen.findByText('No results match your filters.')).toBeTruthy();
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
