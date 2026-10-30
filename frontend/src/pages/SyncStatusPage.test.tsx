// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    malformed: 0,
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
    api.mockImplementation((endpoint: string, options?: { body?: string }) => {
      const body = options?.body ? (JSON.parse(options.body) as { op: string }) : null;
      if (body?.op === 'syncStatus') return Promise.resolve(status());
      return Promise.resolve(eventsPage());
    });
    renderPage();

    expect(await screen.findByText('Ta Nang basecamp laptop')).toBeTruthy();
    expect(screen.getByText('UP')).toBeTruthy();
    expect(screen.getByText('26')).toBeTruthy();
    expect(screen.getByText('Connected')).toBeTruthy();
    expect(screen.getByText('0, 0, 2, 9')).toBeTruthy();
    expect(api.mock.calls[0][0]).toBe('/gateway-sync');
    expect(JSON.parse((api.mock.calls[0][1] as { body: string }).body)).toEqual({
      op: 'syncStatus',
      windowMinutes: 60,
    });
  });

  it('shows the recent field events', async () => {
    api.mockImplementation((endpoint: string, options?: { body?: string }) => {
      const body = options?.body ? (JSON.parse(options.body) as { op: string }) : null;
      if (body?.op === 'syncStatus') return Promise.resolve(status());
      return Promise.resolve(
        eventsPage([
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
      );
    });
    renderPage();

    expect(await screen.findByText('TL-0009')).toBeTruthy();
    expect(screen.getByText('POSITION')).toBeTruthy();
    expect(screen.getByText('Field Station')).toBeTruthy();
    expect(screen.getByText('Attributed')).toBeTruthy();
  });

  it('shows the empty state with no Field Stations, and refetches both reads on Refresh', async () => {
    api.mockImplementation((endpoint: string, options?: { body?: string }) => {
      const body = options?.body ? (JSON.parse(options.body) as { op: string }) : null;
      if (body?.op === 'syncStatus') return Promise.resolve(status({ fieldStations: [] }));
      return Promise.resolve(eventsPage());
    });
    renderPage();

    expect(await screen.findByText('No Field Stations are registered yet.')).toBeTruthy();
    expect(screen.getByText('No field events have been ingested yet.')).toBeTruthy();

    api.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(api).toHaveBeenCalled());
  });

  it('re-requests the status with the selected window', async () => {
    api.mockImplementation((endpoint: string, options?: { body?: string }) => {
      const body = options?.body ? (JSON.parse(options.body) as { op: string }) : null;
      if (body?.op === 'syncStatus') return Promise.resolve(status());
      return Promise.resolve(eventsPage());
    });
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
});
