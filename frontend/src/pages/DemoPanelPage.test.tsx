// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { panelPassword, type PanelOverview, type PlaybackState } from '../entities/demo/panel';
import { DemoPanelPage } from './DemoPanelPage';

const PASSWORD = 'the right panel password';

const IDLE: PlaybackState = {
  flow: null,
  status: 'IDLE',
  index: 0,
  intervalSeconds: 10,
  nextAt: null,
  steps: [],
  error: null,
};

const PLAYING: PlaybackState = {
  flow: 'MF-03',
  status: 'PAUSED',
  index: 1,
  intervalSeconds: 10,
  nextAt: null,
  error: null,
  steps: [
    { title: 'SOS from TL-0010 (simulated)', window: 'Physical unit', screen: 'Gateway log', line: 'The hiker holds the SOS button.', click: 'None.', status: 'DONE', prompt: null, error: null, records: [{ label: 'Simulated SOS, TL-0010', code: 'INC-2026-000002', path: '/o/incidents/i-1' }] },
    { title: 'Operator acknowledges', window: 'C, Operator', screen: '/o/incidents', line: 'The Operator takes ownership.', click: 'Acknowledge on the banner.', status: 'PENDING', prompt: null, error: null, records: [] },
  ],
};

const overview = (patch: Partial<PanelOverview> = {}): PanelOverview => ({
  writable: true,
  actions: [
    { id: 'incident-sos', group: 'Incidents', label: 'Send SOS', needs: ['deviceId'] },
    { id: 'incident-acknowledge', group: 'Incidents', label: 'Acknowledge', needs: ['recordId', 'expectedVersion'] },
    { id: 'incident-close', group: 'Incidents', label: 'Close (demo time)', needs: ['recordId', 'expectedVersion'] },
    { id: 'contract-create', group: 'Contracts', label: 'Request a contract', needs: [] },
    { id: 'invoice-pay', group: 'Billing', label: 'Pay at the counter', needs: ['recordId'] },
    { id: 'device-maintenance-complete', group: 'Devices', label: 'Complete maintenance', needs: ['deviceId'] },
  ],
  options: {
    incidents: [{ id: 'i-1', code: 'INC-2026-000002', state: 'NOTIFY_PRIMARY', version: 3, organizationId: 'o', deviceId: 'd-10', simulated: true }],
    contracts: [],
    invoices: [],
    devices: [{ id: 'd-10', assetTag: 'TL-0010', status: 'RENTED', version: 1, nodeNum: 1 }],
    organizations: [],
    variants: [],
  },
  playback: IDLE,
  reset: { available: false, reason: 'The demo reseed is off on this deployment.', nextAllowedAt: null },
  ...patch,
});

const envelope = (status: number, result: unknown, message = 'OK') =>
  new Response(JSON.stringify({ result, isSuccess: status < 400, statusCode: status, message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

type Handler = (url: string, init: RequestInit) => Response;
let handler: Handler;
const fetchMock = vi.fn((url: string, init: RequestInit) => Promise.resolve(handler(url, init)));
const headerOf = (init: RequestInit) => (init.headers as Record<string, string>)['X-Demo-Panel-Password'];
const callsTo = (path: string) =>
  fetchMock.mock.calls.filter(([url]) => url.endsWith(path)) as [string, RequestInit][];

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <DemoPanelPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const unlock = async () => {
  renderPage();
  fireEvent.change(screen.getByLabelText(/Panel password/), { target: { value: PASSWORD } });
  fireEvent.click(screen.getByRole('button', { name: 'Open the panel' }));
  await screen.findByRole('tab', { name: 'Panel operator' });
};

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
  handler = (_url, init) =>
    headerOf(init) === PASSWORD ? envelope(200, overview()) : envelope(401, { errorCode: 'DEMO_PANEL_PASSWORD_INVALID' }, 'Enter the panel password.');
});
afterEach(() => {
  cleanup();
  panelPassword.clear();
  vi.unstubAllGlobals();
});

describe('DemoPanelPage password gate (REQ-PNL-02, ui-panel.md)', () => {
  it('names the wrong password under the field and keeps nothing in storage', async () => {
    const local = vi.spyOn(Storage.prototype, 'setItem');
    renderPage();
    fireEvent.change(screen.getByLabelText(/Panel password/), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open the panel' }));
    expect(await screen.findByText('The panel password is wrong. Check it with the leader.')).toBeTruthy();
    expect(panelPassword.get()).toBeNull();
    expect(local).not.toHaveBeenCalled();
    local.mockRestore();
  });

  it('opens the three views with the right password, sending it in the header only', async () => {
    const local = vi.spyOn(Storage.prototype, 'setItem');
    await unlock();
    expect(screen.getByRole('tab', { name: 'Presenter' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Site clicker' })).toBeTruthy();
    const [url, init] = callsTo('/demo/panel')[0];
    expect(url).not.toContain(PASSWORD);
    expect(headerOf(init)).toBe(PASSWORD);
    expect(local).not.toHaveBeenCalled();
    local.mockRestore();
  });

  it('says the panel is off on a 404, with a way back to /demo', async () => {
    handler = () => envelope(404, { errorCode: 'NOT_FOUND' }, 'Not found.');
    renderPage();
    fireEvent.change(screen.getByLabelText(/Panel password/), { target: { value: PASSWORD } });
    fireEvent.click(screen.getByRole('button', { name: 'Open the panel' }));
    expect(await screen.findByText('The demo panel is off on this deployment.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to demo sign-in' }).getAttribute('href')).toBe('/demo');
  });

  it('shows the failure limit message from the server', async () => {
    handler = () => envelope(429, { errorCode: 'RATE_LIMITED' }, 'Too many wrong panel passwords. Try again after 10:25.');
    renderPage();
    fireEvent.change(screen.getByLabelText(/Panel password/), { target: { value: PASSWORD } });
    fireEvent.click(screen.getByRole('button', { name: 'Open the panel' }));
    expect(await screen.findByText('Too many wrong panel passwords. Try again after 10:25.')).toBeTruthy();
  });

  it('forgets the password on Lock', async () => {
    await unlock();
    fireEvent.click(screen.getByRole('button', { name: 'Lock' }));
    expect(panelPassword.get()).toBeNull();
    expect(await screen.findByLabelText(/Panel password/)).toBeTruthy();
  });
});

describe('DemoPanelPage panel operator (REQ-PNL-07 to REQ-PNL-09)', () => {
  it('acknowledges the chosen incident with its version and shows the result in the live region', async () => {
    const base = handler;
    handler = (url, init) =>
      url.endsWith('/actions/incident-acknowledge')
        ? envelope(200, {
            action: 'incident-acknowledge',
            runId: 7,
            label: 'Demo 7',
            actedAs: { role: 'ORG_OPERATOR', email: 'treklink.dev+operator@gmail.com' },
            records: [{ label: 'Incident, acknowledged', code: 'INC-2026-000002', path: '/o/incidents/i-1' }],
          })
        : base(url, init);
    await unlock();
    const incidents = screen.getByRole('region', { name: 'Incidents' });
    const acknowledge = within(incidents).getByRole('button', { name: 'Acknowledge' }) as HTMLButtonElement;
    expect(acknowledge.disabled).toBe(true);
    fireEvent.change(within(incidents).getByLabelText('Incident'), { target: { value: 'i-1' } });
    fireEvent.click(acknowledge);
    await waitFor(() => expect(callsTo('/actions/incident-acknowledge')).toHaveLength(1));
    const [, init] = callsTo('/actions/incident-acknowledge')[0];
    expect(JSON.parse(init.body as string)).toEqual({ recordId: 'i-1', expectedVersion: 3 });
    expect(headerOf(init)).toBe(PASSWORD);
    const status = screen.getByRole('status', { name: 'Panel status' });
    await waitFor(() =>
      expect(status.textContent).toBe('Acknowledge: done as treklink.dev+operator@gmail.com.'),
    );
    expect(screen.getByRole('link', { name: 'INC-2026-000002' }).getAttribute('href')).toBe('/o/incidents/i-1');
  });

  it('asks before a one-way action and shows a refusal with its committed links', async () => {
    const base = handler;
    handler = (url, init) =>
      url.endsWith('/actions/incident-close')
        ? new Response(
            JSON.stringify({
              result: { errorCode: 'INVALID_STATE_TRANSITION', runId: 8, label: 'Demo 8', records: [{ label: 'Incident', code: 'INC-2026-000002', path: '/o/incidents/i-1' }] },
              isSuccess: false,
              statusCode: 409,
              message: 'This cannot be done while it is NOTIFY_PRIMARY.',
            }),
            { status: 409 },
          )
        : base(url, init);
    await unlock();
    const incidents = screen.getByRole('region', { name: 'Incidents' });
    fireEvent.change(within(incidents).getByLabelText('Incident'), { target: { value: 'i-1' } });
    fireEvent.click(within(incidents).getByRole('button', { name: 'Close (demo time)' }));
    const dialog = await screen.findByRole('dialog');
    expect(callsTo('/actions/incident-close')).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close (demo time)' }));
    expect(await screen.findByText('This cannot be done while it is NOTIFY_PRIMARY.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'INC-2026-000002' })).toBeTruthy();
  });

  it('starts a playback with the chosen flow and interval', async () => {
    const base = handler;
    handler = (url, init) =>
      url.endsWith('/demo/panel/playback') ? envelope(200, { ...PLAYING, status: 'RUNNING' }) : base(url, init);
    await unlock();
    fireEvent.change(screen.getByLabelText('Main flow'), { target: { value: 'MF-03' } });
    fireEvent.change(screen.getByLabelText('Seconds between steps'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(callsTo('/demo/panel/playback')).toHaveLength(1));
    expect(JSON.parse(callsTo('/demo/panel/playback')[0][1].body as string)).toEqual({
      command: 'START',
      flow: 'MF-03',
      intervalSeconds: 5,
    });
  });

  it('shows why a reseed is unavailable and keeps its button disabled', async () => {
    await unlock();
    expect(screen.getByText('The demo reseed is off on this deployment.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Reseed the demo database' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('reseeds only after the exact typed confirmation', async () => {
    handler = (url, init) => {
      if (headerOf(init) !== PASSWORD) return envelope(401, { errorCode: 'DEMO_PANEL_PASSWORD_INVALID' });
      if (url.endsWith('/demo/panel/reset')) return envelope(200, { resetAt: 'now', tables: 60, seedGroups: 20 });
      return envelope(200, overview({ reset: { available: true, reason: null, nextAllowedAt: null } }));
    };
    await unlock();
    fireEvent.click(screen.getByRole('button', { name: 'Reseed the demo database' }));
    const dialog = await screen.findByRole('dialog');
    const reseed = within(dialog).getByRole('button', { name: 'Reseed' }) as HTMLButtonElement;
    const typed = within(dialog).getByLabelText('Type RESET DEMO DATA to confirm');
    fireEvent.change(typed, { target: { value: 'reset demo data' } });
    expect(reseed.disabled).toBe(true);
    fireEvent.change(typed, { target: { value: 'RESET DEMO DATA' } });
    expect(reseed.disabled).toBe(false);
    fireEvent.click(reseed);
    await waitFor(() => expect(callsTo('/demo/panel/reset')).toHaveLength(1));
    expect(JSON.parse(callsTo('/demo/panel/reset')[0][1].body as string)).toEqual({ confirmation: 'RESET DEMO DATA' });
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Panel status' }).textContent).toBe('Demo data reseeded. Every window must sign in again.'),
    );
  });
});

describe('DemoPanelPage presenter and site clicker views', () => {
  beforeEach(() => {
    handler = (_url, init) =>
      headerOf(init) === PASSWORD ? envelope(200, overview({ playback: PLAYING })) : envelope(401, {});
  });

  it('lists the flow steps for the presenter with the current step marked', async () => {
    await unlock();
    fireEvent.click(screen.getByRole('tab', { name: 'Presenter' }));
    expect(screen.getByRole('heading', { name: 'MF-03: Paused' })).toBeTruthy();
    const current = screen.getByText('2. Operator acknowledges').closest('li')!;
    expect(current.getAttribute('aria-current')).toBe('step');
    expect(within(current).getByText('The Operator takes ownership.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull();
  });

  it('tells the site clicker the window, page and click of the next step, and the last links', async () => {
    await unlock();
    fireEvent.click(screen.getByRole('tab', { name: 'Site clicker' }));
    expect(screen.getByRole('heading', { name: 'Next: Operator acknowledges' })).toBeTruthy();
    expect(screen.getByText('C, Operator')).toBeTruthy();
    expect(screen.getByText('Acknowledge on the banner.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'INC-2026-000002' }).getAttribute('href')).toBe('/o/incidents/i-1');
  });
});

describe('DemoPanelPage waiting step (D-110 rule 8: no Admin actor)', () => {
  const PROMPT =
    'Approve ORG-0009 on the Admin screen (Organizations, tab Pending, Approve). The playback resumes by itself once it is Active, or press Resume.';
  const WAITING: PlaybackState = {
    ...PLAYING,
    flow: 'MF-01a',
    index: 2,
    steps: [
      { ...PLAYING.steps[0], title: 'Organization registers' },
      { ...PLAYING.steps[1], title: 'Staff record counter verification', status: 'DONE' },
      { title: 'Admin approves the organization on the real screen', window: 'D, Admin', screen: '/t/organizations', line: 'Only an Admin approves.', click: 'Tab Pending, the new organization, Approve.', status: 'WAITING', prompt: PROMPT, error: null, records: [] },
    ],
  };
  beforeEach(() => {
    handler = (_url, init) =>
      headerOf(init) === PASSWORD ? envelope(200, overview({ playback: WAITING })) : envelope(401, {});
  });

  it('shows the operator what to do on the Admin screen and offers Resume', async () => {
    await unlock();
    expect(screen.getByText(PROMPT)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Resume' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('tells the site clicker the same prompt, and the presenter marks the step Waiting', async () => {
    await unlock();
    fireEvent.click(screen.getByRole('tab', { name: 'Site clicker' }));
    expect(screen.getByText('The panel is waiting for you')).toBeTruthy();
    expect(screen.getByText(PROMPT)).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Presenter' }));
    const step = screen.getByText('3. Admin approves the organization on the real screen').closest('li')!;
    expect(within(step).getByText('Waiting')).toBeTruthy();
    expect(within(step).getByText(PROMPT)).toBeTruthy();
  });
});

describe('DemoPanelPage skipped step (review of treklink-web#541)', () => {
  const SKIPPED: PlaybackState = {
    ...PLAYING,
    flow: 'MF-01a',
    status: 'DONE',
    index: 2,
    steps: [
      { ...PLAYING.steps[0], title: 'Organization registers' },
      { title: 'Admin approves the organization on the real screen', window: 'D, Admin', screen: '/t/organizations', line: 'Only an Admin approves.', click: 'Approve.', status: 'SKIPPED', prompt: null, error: null, records: [] },
    ],
  };
  beforeEach(() => {
    handler = (_url, init) =>
      headerOf(init) === PASSWORD ? envelope(200, overview({ playback: SKIPPED })) : envelope(401, {});
  });

  it('shows a skipped step as skipped in the operator, presenter and site clicker views', async () => {
    await unlock();
    expect(screen.getByText('Skipped: Admin approves the organization on the real screen')).toBeTruthy();
    expect(screen.getByText('All 2 steps finished, 1 skipped.')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Presenter' }));
    const step = screen.getByText('2. Admin approves the organization on the real screen').closest('li')!;
    expect(within(step).getByText('Skipped')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Site clicker' }));
    expect(
      screen.getByRole('heading', { name: 'Skipped: Admin approves the organization on the real screen' }),
    ).toBeTruthy();
  });
});
