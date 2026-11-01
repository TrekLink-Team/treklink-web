// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../shared/api/apiClient';
import { AuthorityReportsPanel, CloseCaseDialog, ReportDialog } from './AuthorityReports';

const api = vi.fn();
vi.mock('../../shared/api/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../shared/api/apiClient')>()),
  apiClient: (...args: unknown[]) => api(...args),
}));

const incident = (overrides: Record<string, unknown> = {}) => ({
  id: 'inc-1',
  code: 'INC-2026-000007',
  device: { id: 'd-1', assetTag: 'TL-0010', holder: null },
  organizationId: null,
  contractId: null,
  state: 'UNROUTED',
  stateChangedAt: '2026-11-01T03:20:00Z',
  source: 'DEVICE_SOS',
  confidence: 'CONFIRMED',
  firstEventAt: '2026-11-01T03:15:00Z',
  lastEventAt: '2026-11-01T03:15:30Z',
  eventCount: 1,
  lastPosition: null,
  stale: false,
  owner: null,
  tierDeadlineAt: null,
  statusDueAt: null,
  reopenCount: 0,
  version: 2,
  statusUpdates: [],
  authorityReports: [],
  ...overrides,
});

const report = (overrides: Record<string, unknown> = {}) => ({
  id: 'ar-1',
  incidentId: 'inc-1',
  contractId: null,
  agency: 'Lam Dong rescue (114)',
  reference: 'LD-114-07',
  reportedAt: '2026-11-01T03:25:00Z',
  caseClosedAt: null,
  ...overrides,
});

const page = (items: unknown[]) => ({
  items,
  pageNumber: 1,
  pageSize: 20,
  totalCount: items.length,
  totalPages: items.length > 0 ? 1 : 0,
});

const renderWith = (node: React.ReactElement) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );

type Call = [string, { method?: string; body?: string }?];
const posts = () =>
  (api.mock.calls as Call[])
    .filter(([, init]) => init?.method === 'POST')
    .map(([endpoint, init]) => [
      endpoint,
      JSON.parse(init?.body ?? '{}') as Record<string, unknown>,
    ]);

const fill = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => api.mockReset());
afterEach(cleanup);

describe('AuthorityReportsPanel (screen 8.3, api-design 11)', () => {
  it('reads open cases by default and all reports without the open flag', async () => {
    api.mockResolvedValue(
      page([report(), report({ id: 'ar-2', incidentId: null, contractId: 'c-1' })]),
    );
    renderWith(<AuthorityReportsPanel onViewIncident={() => undefined} />);
    expect(await screen.findAllByText('LD-114-07')).toHaveLength(2);
    expect(String(api.mock.calls[0][0])).toBe(
      '/authority-reports?open=true&pageNumber=1&pageSize=20',
    );
    expect(screen.getByRole('link', { name: 'View contract' }).getAttribute('href')).toBe(
      '/t/contracts/c-1',
    );
    expect(screen.getAllByText('Open')).toHaveLength(2);
    expect(screen.getByText(/does not coordinate rescue operations/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Open cases only'));
    await waitFor(() =>
      expect(String(api.mock.calls[api.mock.calls.length - 1][0])).toBe(
        '/authority-reports?pageNumber=1&pageSize=20',
      ),
    );
  });

  it('shows the empty states, and closed cases without a close action', async () => {
    api.mockResolvedValueOnce(page([]));
    renderWith(<AuthorityReportsPanel onViewIncident={() => undefined} />);
    expect(await screen.findByText('No open authority cases.')).toBeTruthy();
    api.mockResolvedValueOnce(page([report({ caseClosedAt: '2026-11-02T08:00:00Z' })]));
    fireEvent.click(screen.getByLabelText('Open cases only'));
    expect(await screen.findByText(/^Closed /)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Record case closed/ })).toBeNull();
  });

  it('opens the linked incident through the callback', async () => {
    const onViewIncident = vi.fn();
    api.mockResolvedValue(page([report()]));
    renderWith(<AuthorityReportsPanel onViewIncident={onViewIncident} />);
    fireEvent.click(await screen.findByRole('button', { name: 'View incident' }));
    expect(onViewIncident).toHaveBeenCalledWith('inc-1');
  });
});

describe('ReportDialog (api-design 08 and 10)', () => {
  it('records an incident report from the incident entry with its version', async () => {
    const onClose = vi.fn();
    api.mockImplementation((endpoint: string, init?: { method?: string }) =>
      Promise.resolve(init?.method === 'POST' ? incident({ state: 'REPORTED' }) : incident()),
    );
    renderWith(<ReportDialog entry={{ kind: 'incident', id: 'inc-1' }} onClose={onClose} />);
    expect(await screen.findByText('Incident INC-2026-000007, Unrouted')).toBeTruthy();
    expect(screen.getByText('This records a report you have already made.')).toBeTruthy();
    expect(screen.getByLabelText(/^Agency/).getAttribute('maxlength')).toBe('200');
    expect(screen.getByLabelText(/^Authority reference/).getAttribute('maxlength')).toBe('200');
    fireEvent.click(screen.getByRole('button', { name: 'Record report' }));
    // Agency and reference; Reported at starts at now.
    expect(await screen.findAllByText('Please fill in this field.')).toHaveLength(2);
    expect(posts()).toHaveLength(0);
    fill(/^Agency/, ' Lam Dong rescue (114) ');
    fill(/^Authority reference/, 'LD-114-07');
    fill(/^Reported at/, '2026-11-01T10:25');
    fill(/^Note/, '  ');
    fireEvent.click(screen.getByRole('button', { name: 'Record report' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [[endpoint, body]] = posts();
    expect(endpoint).toBe('/incidents/inc-1/authority-reports');
    expect(body).toEqual({
      agency: 'Lam Dong rescue (114)',
      reference: 'LD-114-07',
      reportedAt: new Date('2026-11-01T10:25').toISOString(),
      expectedVersion: 2,
    });
  });

  it('refuses an incident no longer eligible before the details step (MSG28)', async () => {
    api.mockResolvedValue(incident({ state: 'ACKNOWLEDGED' }));
    renderWith(
      <ReportDialog entry={{ kind: 'incident', id: 'inc-1' }} onClose={() => undefined} />,
    );
    expect(await screen.findByText('This cannot be done while it is Acknowledged.')).toBeTruthy();
    expect(screen.queryByLabelText(/^Agency/)).toBeNull();
  });

  it('keeps the values on STALE_VERSION and reloads the version before a deliberate resubmit', async () => {
    let version = 2;
    api.mockImplementation((_endpoint: string, init?: { method?: string }) => {
      if (init?.method === 'POST') {
        if (version === 2)
          return Promise.reject(
            new ApiError(
              409,
              'STALE_VERSION',
              'This was changed by someone else. Reload and try again.',
            ),
          );
        return Promise.resolve(incident({ state: 'REPORTED' }));
      }
      return Promise.resolve(incident({ version }));
    });
    renderWith(
      <ReportDialog entry={{ kind: 'incident', id: 'inc-1' }} onClose={() => undefined} />,
    );
    await screen.findByText('Incident INC-2026-000007, Unrouted');
    fill(/^Agency/, '114');
    fill(/^Authority reference/, 'LD-1');
    fill(/^Reported at/, '2026-11-01T10:25');
    fireEvent.click(screen.getByRole('button', { name: 'Record report' }));
    expect(await screen.findByText(/changed by someone else/)).toBeTruthy();
    version = 3;
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(screen.queryByText(/changed by someone else/)).toBeNull());
    expect((screen.getByLabelText(/^Agency/) as HTMLInputElement).value).toBe('114');
    fireEvent.click(screen.getByRole('button', { name: 'Record report' }));
    await waitFor(() => expect(posts()).toHaveLength(2));
    expect(posts()[1][1]).toMatchObject({ expectedVersion: 3 });
  });

  it('records a contract report after choosing a defaulted contract', async () => {
    const contract = {
      id: 'c-1',
      code: 'CT-2026-0009',
      status: 'DEFAULTED',
      organization: { legalName: 'Da Lat Treks' },
    };
    api.mockImplementation((endpoint: string, init?: { method?: string }) => {
      if (init?.method === 'POST')
        return Promise.resolve(report({ incidentId: null, contractId: 'c-1' }));
      if (String(endpoint).startsWith('/contracts?')) return Promise.resolve(page([contract]));
      if (endpoint === '/contracts/c-1') return Promise.resolve(contract);
      return Promise.resolve(page([]));
    });
    const onClose = vi.fn();
    renderWith(<ReportDialog onClose={onClose} />);
    fireEvent.change(screen.getByLabelText(/^Subject kind/), { target: { value: 'contract' } });
    fireEvent.click(await screen.findByRole('button', { name: /CT-2026-0009, Da Lat Treks/ }));
    expect(await screen.findByText('Contract CT-2026-0009, Defaulted, Da Lat Treks')).toBeTruthy();
    expect(
      (api.mock.calls as Call[]).some(([endpoint]) =>
        endpoint.startsWith('/contracts?status=DEFAULTED'),
      ),
    ).toBe(true);
    fill(/^Agency/, 'District 1 police');
    fill(/^Authority reference/, 'PC-Q1-338');
    fill(/^Reported at/, '2026-11-30T09:00');
    fill(/^Note/, 'Audit log sent');
    fireEvent.click(screen.getByRole('button', { name: 'Record report' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(posts()[0]).toEqual([
      '/authority-reports',
      {
        agency: 'District 1 police',
        reference: 'PC-Q1-338',
        reportedAt: new Date('2026-11-30T09:00').toISOString(),
        note: 'Audit log sent',
        contractId: 'c-1',
      },
    ]);
  });

  it('asks before discarding a dirty draft', async () => {
    const onClose = vi.fn();
    api.mockResolvedValue(incident());
    renderWith(<ReportDialog entry={{ kind: 'incident', id: 'inc-1' }} onClose={onClose} />);
    await screen.findByText('Incident INC-2026-000007, Unrouted');
    fill(/^Agency/, '114');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect((screen.getByLabelText(/^Agency/) as HTMLInputElement).value).toBe('114');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard report' }));
    expect(onClose).toHaveBeenCalled();
  });
  it('starts Reported at at now, and closes untouched without asking', async () => {
    const onClose = vi.fn();
    api.mockResolvedValue(incident());
    renderWith(<ReportDialog entry={{ kind: 'incident', id: 'inc-1' }} onClose={onClose} />);
    await screen.findByText('Incident INC-2026-000007, Unrouted');
    // A datetime-local value drops the seconds when they are zero, so a run on the minute reads HH:MM.
    expect((screen.getByLabelText(/^Reported at/) as HTMLInputElement).value).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('CloseCaseDialog (api-design 09)', () => {
  it('names the case, requires the closure time and posts it', async () => {
    const onClose = vi.fn();
    api.mockResolvedValue({
      id: 'ar-1',
      caseClosedAt: '2026-11-02T01:00:00Z',
      incidentState: 'CLOSED',
    });
    renderWith(<CloseCaseDialog report={report()} onClose={onClose} />);
    // Non-breaking hyphens keep the reference on one line.
    expect(
      screen.getByText('Record case LD\u2011114\u201107 with Lam Dong rescue (114) closed?'),
    ).toBeTruthy();
    // Closed at starts at now; cleared, it is required.
    expect((screen.getByLabelText(/^Closed at/) as HTMLInputElement).value).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/,
    );
    fill(/^Closed at/, '');
    fireEvent.click(screen.getByRole('button', { name: /^Record case closed/ }));
    expect(await screen.findByText('Please fill in this field.')).toBeTruthy();
    fill(/^Closed at/, '2026-11-02T08:00');
    fill(/^Closure note/, 'Found safe');
    fireEvent.click(screen.getByRole('button', { name: /^Record case closed/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(posts()[0]).toEqual([
      '/authority-reports/ar-1/close-case',
      { closedAt: new Date('2026-11-02T08:00').toISOString(), note: 'Found safe' },
    ]);
  });

  it('shows CASE_ALREADY_CLOSED and stays open', async () => {
    const onClose = vi.fn();
    api.mockImplementationOnce(() =>
      Promise.reject(
        new ApiError(409, 'CASE_ALREADY_CLOSED', 'This cannot be done while it is CLOSED.'),
      ),
    );
    renderWith(<CloseCaseDialog report={report()} onClose={onClose} />);
    fill(/^Closed at/, '2026-11-02T08:00');
    fireEvent.click(screen.getByRole('button', { name: /^Record case closed/ }));
    expect(await screen.findByText('This cannot be done while it is CLOSED.')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect(posts()).toHaveLength(1);
  });

  it('shows a refused closure time under Closed at and keeps the dialog open', async () => {
    const onClose = vi.fn();
    api.mockImplementationOnce(() =>
      Promise.reject(
        new ApiError(400, 'VALIDATION_FAILED', 'closedAt must not be before reportedAt.'),
      ),
    );
    renderWith(<CloseCaseDialog report={report()} onClose={onClose} />);
    expect(screen.getByText(/not before the report time/)).toBeTruthy();
    fill(/^Closed at/, '2026-10-01T08:00');
    fireEvent.click(screen.getByRole('button', { name: /^Record case closed/ }));
    expect(await screen.findByText('closedAt must not be before reportedAt.')).toBeTruthy();
    expect(screen.getByLabelText(/^Closed at/).getAttribute('aria-invalid')).toBe('true');
    expect(onClose).not.toHaveBeenCalled();
    fill(/^Closed at/, '2026-11-02T08:00');
    expect(screen.queryByText('closedAt must not be before reportedAt.')).toBeNull();
  });
});
