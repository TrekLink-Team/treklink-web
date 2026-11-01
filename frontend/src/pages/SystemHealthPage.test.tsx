// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SystemHealth } from '../entities/system-health/api';
import { ApiError } from '../shared/api/apiClient';
import { SystemHealthPage } from './SystemHealthPage';

const api = vi.fn();
vi.mock('../shared/api/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/api/apiClient')>()),
  apiClient: (...args: unknown[]) => api(...args),
}));

const station = (overrides: Record<string, unknown> = {}) => ({
  id: 'fs-1',
  name: 'Ta Nang basecamp laptop',
  organization: { id: 'org-1', name: 'ACME Trek Co., Ltd.' },
  lastSyncAt: '2026-10-20T03:15:00.000Z',
  stale: false,
  queueDepth: { p0: 0, p1: 0, p2: 14, p3: 230 },
  oldestRetryCount: 2,
  version: '1.2.0',
  outdated: false,
  ...overrides,
});

const health = (overrides: Partial<SystemHealth> = {}): SystemHealth => ({
  health: { status: 'ok', components: { database: 'up', mqtt: 'up' } },
  ingestion: { perMinute: 41.2, accepted: 2471, duplicates: 12, malformed: 0, unknownDevice: 1 },
  fieldStations: {
    total: 2,
    stale: 1,
    outdated: 1,
    currentRelease: '1.2.0',
    maxQueueDepth: { p0: 0, p1: 0, p2: 14, p3: 230 },
    items: [
      station(),
      station({ id: 'fs-2', name: 'Old laptop', version: '1.1.0', outdated: true, stale: true }),
    ],
  },
  devicesBuffering: 2,
  alerts: { pending: 0, failed: 1 },
  ...overrides,
});

const renderPage = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <SystemHealthPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

// The table only: the phone cards repeat each row.
const table = () => within(screen.getByRole('table', { name: 'Field Stations' }));
const card = (name: string) => within(screen.getByRole('region', { name }));

beforeEach(() => {
  api.mockReset();
});
afterEach(cleanup);

describe('SystemHealthPage (screen 9.3)', () => {
  it('shows the platform status and its components as text', async () => {
    api.mockResolvedValue(health());
    renderPage();
    await screen.findByRole('region', { name: 'Platform' });
    expect(card('Platform').getByText('OK')).toBeTruthy();
    expect(card('Platform').getByText('Database')).toBeTruthy();
    expect(card('Platform').getAllByText('UP')).toHaveLength(2);
  });

  it('shows DEGRADED and a broker that is down', async () => {
    api.mockResolvedValue(
      health({ health: { status: 'degraded', components: { database: 'up', mqtt: 'down' } } }),
    );
    renderPage();
    await screen.findByRole('region', { name: 'Platform' });
    expect(card('Platform').getByText('DEGRADED')).toBeTruthy();
    expect(card('Platform').getByText('DOWN')).toBeTruthy();
  });

  it('never shows an MQTT broker with no probe as UP', async () => {
    api.mockResolvedValue(
      health({ health: { status: 'ok', components: { database: 'up', mqtt: 'unknown' } } }),
    );
    renderPage();
    await screen.findByRole('region', { name: 'Platform' });
    expect(card('Platform').getByText('UNKNOWN')).toBeTruthy();
    expect(card('Platform').getByText('No probe is registered')).toBeTruthy();
  });

  it('shows the alert counts and a link to the incidents when some failed', async () => {
    api.mockResolvedValue(health());
    renderPage();
    await screen.findByRole('region', { name: 'Alert delivery' });
    expect(card('Alert delivery').getByText('Failed')).toBeTruthy();
    expect(card('Alert delivery').getByText(/1 alert could not be delivered/)).toBeTruthy();
    expect(
      card('Alert delivery').getByRole('link', { name: 'View failed alerts' }).getAttribute('href'),
    ).toBe('/t/incidents');
  });

  it('shows no failed-alert warning when none failed', async () => {
    api.mockResolvedValue(health({ alerts: { pending: 3, failed: 0 } }));
    renderPage();
    await screen.findByRole('region', { name: 'Alert delivery' });
    expect(screen.queryByRole('link', { name: 'View failed alerts' })).toBeNull();
  });

  it('shows the stale count, the deepest queue and the outdated count with the release', async () => {
    api.mockResolvedValue(health());
    renderPage();
    await screen.findByRole('region', { name: 'Field Stations' });
    const stations = card('Field Stations');
    expect(stations.getByText('1 of 2')).toBeTruthy();
    expect(stations.getByText('Deepest queue: p0: 0, p1: 0, p2: 14, p3: 230')).toBeTruthy();
    expect(stations.getByText('1 outdated, current release 1.2.0')).toBeTruthy();
    expect(stations.getByRole('link', { name: 'View Field Stations' }).getAttribute('href')).toBe(
      '/t/organizations',
    );
  });

  it('shows the ingestion figures of the window and the buffering devices', async () => {
    api.mockResolvedValue(health());
    renderPage();
    await screen.findByRole('region', { name: 'Ingestion' });
    expect(card('Ingestion').getByText('Last 60 minutes')).toBeTruthy();
    expect(card('Ingestion').getByText('41.2')).toBeTruthy();
    expect(card('Ingestion').getByText('2471')).toBeTruthy();
    expect(card('Devices buffering').getByText('2')).toBeTruthy();
  });

  it('lists stale and outdated stations first with text badges and the depth per priority', async () => {
    api.mockResolvedValue(health());
    renderPage();
    await screen.findByRole('table', { name: 'Field Stations' });
    const rows = table().getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('Old laptop')).toBeTruthy();
    expect(within(rows[0]).getByText('Stale')).toBeTruthy();
    expect(within(rows[0]).getByText('Outdated')).toBeTruthy();
    expect(within(rows[1]).getByText('Current')).toBeTruthy();
    expect(within(rows[1]).getByText('p0: 0, p1: 0, p2: 14, p3: 230')).toBeTruthy();
    expect(
      within(rows[1]).getByRole('link', { name: 'ACME Trek Co., Ltd.' }).getAttribute('href'),
    ).toBe('/t/organizations');
  });

  it('says so when no Field Station is registered', async () => {
    api.mockResolvedValue(
      health({
        fieldStations: {
          total: 0,
          stale: 0,
          outdated: 0,
          currentRelease: null,
          maxQueueDepth: { p0: 0, p1: 0, p2: 0, p3: 0 },
          items: [],
        },
      }),
    );
    renderPage();
    expect(await screen.findByText('No Field Stations are registered yet.')).toBeTruthy();
    expect(screen.queryByRole('table', { name: 'Field Stations' })).toBeNull();
    expect(card('Field Stations').getByText('Current release unknown')).toBeTruthy();
  });

  it('asks for the chosen window and resets to 60 on a 400', async () => {
    api.mockResolvedValue(health());
    renderPage();
    await screen.findByRole('region', { name: 'Platform' });
    expect(api.mock.calls[0][0]).toBe('/system-health?windowMinutes=60');
    api.mockRejectedValueOnce(
      new ApiError(400, 'VALIDATION_FAILED', 'windowMinutes must not be greater than 1440'),
    );
    fireEvent.change(screen.getByLabelText('Window'), { target: { value: '240' } });
    expect(await screen.findByText('windowMinutes must not be greater than 1440')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use 60 minutes' }));
    await waitFor(() =>
      expect((screen.getByLabelText('Window') as HTMLSelectElement).value).toBe('60'),
    );
    expect(api.mock.calls.some((call) => call[0] === '/system-health?windowMinutes=240')).toBe(
      true,
    );
  });

  it('refreshes, keeps focus on the button and announces the time', async () => {
    api.mockResolvedValue(health());
    renderPage();
    await screen.findByRole('region', { name: 'Platform' });
    const refresh = screen.getByRole('button', { name: 'Refresh' });
    refresh.focus();
    fireEvent.click(refresh);
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(document.querySelector('[aria-live="polite"]')?.textContent).toMatch(
        /^Health updated at \d\d:\d\d:\d\d$/,
      ),
    );
    expect(document.activeElement).toBe(refresh);
  });

  it('keeps the last data with a banner when a later read fails', async () => {
    api.mockResolvedValueOnce(health());
    renderPage();
    await screen.findByRole('region', { name: 'Platform' });
    api.mockRejectedValueOnce(
      new ApiError(503, 'SERVICE_UNAVAILABLE', 'The database is unavailable.'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(
      await screen.findByText(/The database is unavailable\. Showing the data loaded at/),
    ).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Platform' })).toBeTruthy();
  });

  it('offers Try again when nothing ever loaded', async () => {
    api.mockRejectedValue(new ApiError(503, 'SERVICE_UNAVAILABLE', 'The database is unavailable.'));
    renderPage();
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Platform' })).toBeNull();
  });

  it('shows MSG26 alone for a 403', async () => {
    api.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Forbidden'));
    renderPage();
    expect((await screen.findByRole('alert')).textContent).toBe('You do not have access to this.');
    expect(screen.queryByRole('region', { name: 'Platform' })).toBeNull();
  });
});
