// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncStatusPage } from './SyncStatusPage';

const api = vi.fn();
vi.mock('../shared/api/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/api/apiClient')>()),
  apiClient: (...args: unknown[]) => api(...args),
}));

const status = (overrides: Record<string, unknown> = {}) => ({
  broker: { subscriber: 'up' },
  staleAfterSeconds: 180,
  fieldStations: [
    {
      id: 'fs-1',
      name: 'Ta Nang basecamp laptop',
      mqttUsername: 'fs-org-0001-1',
      organization: { id: 'org-1', code: 'ORG-0001', name: 'TrekLink Demo Tours Co., Ltd.' },
      connection: 'CONNECTED',
      lastSyncAt: '2026-11-01T03:15:00.000Z',
      lastFlushAt: '2026-11-01T03:14:55.000Z',
      queueDepth: { p0: 0, p1: 0, p2: 2, p3: 9 },
      oldestRetryCount: 0,
      version: '0.1.0',
    },
  ],
  ingestion: {
    windowMinutes: 60,
    accepted: 26,
    acceptedUnattributed: 1,
    duplicates: 10,
    malformed: 3,
    normalizationFailed: 4,
    unknownDevice: 2,
    lastReceivedAt: '2026-11-01T03:15:00.000Z',
  },
  ...overrides,
});

const eventsPage = (items: unknown[] = []) => ({
  items,
  pageNumber: 1,
  pageSize: 20,
  totalCount: items.length,
  totalPages: items.length > 0 ? 1 : 0,
});

const auditRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'sa-1',
  eventId: '5d41',
  nodeNum: 3724541961,
  deviceId: 'd-1',
  assetTag: 'TL-0010',
  uplinkKey: 'fs-org-0001-1',
  ingress: 'MQTT_NODE',
  outcome: 'DUPLICATE_REJECTED',
  detail: null,
  rawExcerpt: null,
  rawTruncated: false,
  createdAt: '2026-11-01T03:16:00.000Z',
  ...overrides,
});

const auditPage = (items: unknown[] = [], extra: Record<string, unknown> = {}) => ({
  items,
  pageNumber: 1,
  pageSize: 20,
  totalCount: items.length,
  totalPages: items.length > 0 ? 1 : 0,
  ...extra,
});

type Body = { op: string; outcome?: string[]; pageNumber?: number };
const bodyOf = (options?: { body?: string }): Body | null =>
  options?.body ? (JSON.parse(options.body) as Body) : null;

// Answers each operation of POST /api/gateway-sync from its own fixture.
const route =
  (
    reads: {
      status?: unknown;
      events?: unknown;
      audit?: (body: Body) => unknown;
    } = {},
  ) =>
  (endpoint: string, options?: { body?: string }) => {
    const body = bodyOf(options);
    if (body?.op === 'syncStatus') return Promise.resolve(reads.status ?? status());
    if (body?.op === 'listAudit') return Promise.resolve(reads.audit ? reads.audit(body) : auditPage());
    return Promise.resolve(reads.events ?? eventsPage());
  };

const renderPage = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SyncStatusPage />
    </QueryClientProvider>,
  );

beforeEach(() => api.mockReset());
afterEach(cleanup);

describe('SyncStatusPage (/t/admin/sync, MF-02)', () => {
  it('reads the sync status and the recent events on load', async () => {
    api.mockImplementation(route());
    renderPage();

    expect(await screen.findByText('Ta Nang basecamp laptop')).toBeTruthy();
    expect(screen.getByText('UP')).toBeTruthy();
    expect(screen.getByText('26')).toBeTruthy();
    expect(screen.getByText('Connected')).toBeTruthy();
    expect(screen.getByText('0, 0, 2, 9')).toBeTruthy();
    expect(api.mock.calls.every(([endpoint]) => endpoint === '/gateway-sync')).toBe(true);
    const statusCall = api.mock.calls.find(
      ([, options]) => bodyOf(options as { body?: string })?.op === 'syncStatus',
    );
    expect(bodyOf(statusCall![1] as { body?: string })).toEqual({
      op: 'syncStatus',
      windowMinutes: 60,
    });
  });

  it('shows the recent field events', async () => {
    api.mockImplementation(
      route({
        events: eventsPage([
          {
            seq: 88213,
            eventId: 'e-1',
            deviceId: 'd-1',
            assetTag: 'TL-0009',
            organizationId: 'org-1',
            attribution: 'ATTRIBUTED',
            ingress: 'FIELD_STATION',
            uplinkKey: 'fs-org-0001-1',
            kind: 'POSITION',
            priority: 'P2_GPS',
            receivedAt: '2026-11-01T03:15:00.000Z',
            latitude: 11.56,
            longitude: 108.54,
            batteryPct: 81,
            plotted: true,
            incidentId: null,
          },
        ]),
      }),
    );
    renderPage();

    expect(await screen.findByText('TL-0009')).toBeTruthy();
    expect(screen.getByText('POSITION')).toBeTruthy();
    expect(screen.getByText('Field Station')).toBeTruthy();
    expect(screen.getByText('Attributed')).toBeTruthy();
  });

  it('shows the empty states, and refetches every read on Refresh', async () => {
    api.mockImplementation(route({ status: status({ fieldStations: [] }) }));
    renderPage();

    expect(await screen.findByText('No Field Stations are registered yet.')).toBeTruthy();
    expect(screen.getByText('No field events have been ingested yet.')).toBeTruthy();
    expect(await screen.findByText('No ingestion attempts yet.')).toBeTruthy();

    api.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => {
      const ops = api.mock.calls.map(([, options]) => bodyOf(options as { body?: string })?.op);
      expect(ops).toEqual(expect.arrayContaining(['syncStatus', 'listEvents', 'listAudit']));
    });
  });

  it('shows the rejection and unattributed counts next to the existing cards', async () => {
    api.mockImplementation(route());
    renderPage();
    await screen.findByText('Ta Nang basecamp laptop');

    const card = (label: string) =>
      screen.getByText(label, { selector: 'p' }).parentElement!.parentElement!;
    expect(card('Accepted').textContent).toContain('26');
    expect(card('Duplicates rejected').textContent).toContain('10');
    expect(card('Malformed').textContent).toContain('3');
    expect(card('Normalization failed').textContent).toContain('4');
    expect(card('Unattributed').textContent).toContain('1');
    expect(card('Unknown device').textContent).toContain('2');
  });

  it('lists the sync audit, with the raw excerpt of a malformed record and an unregistered node id', async () => {
    api.mockImplementation(
      route({
        audit: () =>
          auditPage([
            auditRow(),
            auditRow({
              id: 'sa-2',
              eventId: null,
              nodeNum: null,
              deviceId: null,
              assetTag: null,
              outcome: 'MALFORMED_ENVELOPE',
              detail: 'message is not JSON',
              rawExcerpt: '{"broken": "xxxx',
              rawTruncated: true,
            }),
            auditRow({
              id: 'sa-3',
              deviceId: null,
              assetTag: null,
              nodeNum: 3724541962,
              outcome: 'UNKNOWN_DEVICE',
            }),
          ]),
      }),
    );
    renderPage();

    const table = await screen.findByRole('table', { name: 'Sync audit records, newest first' });
    expect(within(table).getByText('TL-0010')).toBeTruthy();
    expect(within(table).getByText('Duplicate rejected')).toBeTruthy();
    expect(within(table).getByText('Malformed')).toBeTruthy();
    expect(within(table).getByText('message is not JSON')).toBeTruthy();
    expect(within(table).getByText('{"broken": "xxxx')).toBeTruthy();
    expect(within(table).getByText('Raw payload cut by the server.')).toBeTruthy();
    expect(within(table).getByText('Not decoded')).toBeTruthy();
    expect(within(table).getByText('!de00000a', { selector: 'td' })).toBeTruthy();
  });

  it('filters the audit by outcome from page 1, and pages it', async () => {
    api.mockImplementation(
      route({
        audit: (body) =>
          auditPage([auditRow({ id: `sa-${body.pageNumber}` })], {
            pageNumber: body.pageNumber,
            totalCount: 45,
            totalPages: 3,
          }),
      }),
    );
    renderPage();
    await screen.findByRole('table', { name: 'Sync audit records, newest first' });

    const auditCalls = () =>
      api.mock.calls
        .map(([, options]) => bodyOf(options as { body?: string }))
        .filter((body): body is Body => body?.op === 'listAudit');
    expect(auditCalls()[0]).toEqual({ op: 'listAudit', pageNumber: 1, pageSize: 20 });

    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }));
    await waitFor(() => expect(auditCalls().at(-1)).toMatchObject({ pageNumber: 2 }));

    fireEvent.change(screen.getByLabelText('Outcome'), { target: { value: 'MALFORMED_ENVELOPE' } });
    await waitFor(() =>
      expect(auditCalls().at(-1)).toEqual({
        op: 'listAudit',
        outcome: ['MALFORMED_ENVELOPE'],
        pageNumber: 1,
        pageSize: 20,
      }),
    );
  });

  it('shows the filtered empty state', async () => {
    api.mockImplementation(route());
    renderPage();
    await screen.findByText('No ingestion attempts yet.');
    fireEvent.change(screen.getByLabelText('Outcome'), { target: { value: 'NORMALIZATION_FAILED' } });
    expect(await screen.findByText('No audit records with this outcome.')).toBeTruthy();
  });

  it('re-requests the status with the selected window', async () => {
    api.mockImplementation(route());
    renderPage();
    await screen.findByText('Ta Nang basecamp laptop');

    api.mockClear();
    fireEvent.change(screen.getByLabelText('Window'), { target: { value: '15' } });
    await waitFor(() => expect(api).toHaveBeenCalled());
    const call = api.mock.calls.find(([, options]) => {
      const body = options?.body ? (JSON.parse(options.body) as { op: string }) : null;
      return body?.op === 'syncStatus';
    });
    expect(JSON.parse((call![1] as { body: string }).body)).toEqual({
      op: 'syncStatus',
      windowMinutes: 15,
    });
  });

  it('sorts the field event ledger on the time received through the API order (api-design 03)', async () => {
    api.mockImplementation(
      route({
        events: eventsPage([
          {
            seq: 1,
            eventId: 'e-9',
            deviceId: 'd-1',
            assetTag: 'TL-0009',
            organizationId: 'org-1',
            attribution: 'ATTRIBUTED',
            ingress: 'MQTT_NODE',
            uplinkKey: 'node',
            kind: 'POSITION',
            priority: 'P2_GPS',
            receivedAt: '2026-11-01T03:15:00.000Z',
            latitude: null,
            longitude: null,
            batteryPct: null,
            plotted: false,
            incidentId: null,
          },
        ]),
      }),
    );
    renderPage();
    const sortButton = await screen.findByRole('button', { name: /^Received/ });
    expect(sortButton.closest('th')?.getAttribute('aria-sort')).toBe('descending');
    api.mockClear();
    fireEvent.click(sortButton);
    await waitFor(() => {
      const bodies = api.mock.calls.map(([, options]) => bodyOf(options as { body?: string }));
      expect(bodies).toContainEqual(expect.objectContaining({ op: 'listEvents', order: 'asc', pageNumber: 1 }));
    });
    expect(screen.getByRole('button', { name: /^Received/ }).closest('th')?.getAttribute('aria-sort')).toBe('ascending');
  });
});
