// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapSnapshot, SnapshotDevice } from '../entities/live-map/api';
import { ApiError } from '../shared/api/apiClient';
import type { LiveEntry, LiveMessage } from '../shared/socket/socketClient';
import { LiveMapPage } from './LiveMapPage';

const api = vi.fn();
vi.mock('../shared/api/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/api/apiClient')>()),
  apiClient: (...args: unknown[]) => api(...args),
}));

// The socket client: the page subscribes through subscribeLive; the test feeds the stream.
const listeners = new Set<(message: LiveMessage) => void>();
vi.mock('../shared/socket/socketClient', () => ({
  isLivePaused: () => false,
  subscribeLive: (listener: (message: LiveMessage) => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
}));
const push = (message: LiveMessage) =>
  act(() => listeners.forEach((listener) => listener(message)));
const feed = (entry: Omit<LiveEntry, 'createdAt'>) =>
  push({ kind: 'entry', entry: { createdAt: '2026-10-30T03:00:00.000Z', ...entry } });

const CONFIG = {
  provider: 'example',
  tileUrl: 'https://tiles.example.test/{z}/{x}/{y}.png',
  attribution: '© Example',
  basemaps: [],
  defaultViewport: { lat: 11.56, lon: 108.54, zoom: 12 },
  sovereigntyOverlay: [{ label: 'Quần đảo Hoàng Sa (Việt Nam)', lat: 16.5, lon: 112, mask: [] }],
  staleAfterSeconds: 300,
};

const recent = () => new Date(Date.now() - 10_000).toISOString();

const device = (overrides: Partial<SnapshotDevice> = {}): SnapshotDevice => ({
  id: 'd-9',
  assetTag: 'TL-0009',
  hardwareVariant: 'treklink-v3',
  holder: { name: 'Le Thi E' },
  position: { lat: 11.55, lon: 108.53, at: recent() },
  batteryPct: 80,
  lastSeenAt: recent(),
  stale: false,
  openIncident: null,
  contractCode: 'RC-2026-0001',
  organizationId: 'org-1',
  ...overrides,
});

let snapshot: MapSnapshot;
let snapshotError: Error | null;

const respond = (path: string) => {
  if (path === '/map/config') return Promise.resolve(CONFIG);
  if (path.startsWith('/map/snapshot'))
    return snapshotError ? Promise.reject(snapshotError) : Promise.resolve(snapshot);
  if (path.startsWith('/organizations'))
    return Promise.resolve({
      items: [{ id: 'org-2', code: 'ORG-0002', legalName: 'Other Trek' }],
      totalCount: 1,
    });
  return Promise.reject(new Error(`unexpected ${path}`));
};

const show = (scope: 'o' | 't') =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <LiveMapPage scope={scope} />
      </MemoryRouter>
    </QueryClientProvider>,
  );

// The history route of screen 9.2, standing in for the page: it shows where the link led.
const HistoryProbe: React.FC = () => {
  const { id } = useParams();
  const { pathname, state } = useLocation();
  return (
    <p>
      history {pathname} {id} {(state as { assetTag?: string } | null)?.assetTag}
    </p>
  );
};

const showWithHistory = (scope: 'o' | 't') =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[`/${scope}/map`]}>
        <Routes>
          <Route path={`/${scope}/map`} element={<LiveMapPage scope={scope} />} />
          <Route path={`/${scope}/devices/:id/telemetry`} element={<HistoryProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

const panel = () => within(screen.getByRole('complementary', { name: 'Devices' }));
const marker = (name: string | RegExp) => screen.findByRole('img', { name });

beforeEach(() => {
  snapshot = { cursor: 100, devices: [device()], fieldStations: [] };
  snapshotError = null;
  api.mockReset();
  api.mockImplementation((path: string) => respond(path));
});
afterEach(() => {
  cleanup();
  listeners.clear();
});

describe('LiveMapPage (screen 9.1)', () => {
  it('draws the snapshot as markers and list rows on the organization map', async () => {
    show('o');
    expect(await marker('TL-0009, Le Thi E')).toBeTruthy();
    expect(panel().getByText('1 device, 0 SOS open, 0 stale')).toBeTruthy();
    expect(panel().getByText('Le Thi E')).toBeTruthy();
    expect(api).toHaveBeenCalledWith('/map/snapshot');
    expect(screen.queryByLabelText('Organization')).toBeNull();
  });

  it('moves the device with stream entries after the cursor and ignores those at or below it', async () => {
    show('o');
    await marker('TL-0009, Le Thi E');
    feed({
      seq: 100,
      type: 'device.telemetry',
      deviceId: 'd-9',
      payload: { batteryPct: 5, at: recent() },
    });
    expect(panel().getByText('80%')).toBeTruthy();

    feed({
      seq: 101,
      type: 'device.telemetry',
      deviceId: 'd-9',
      payload: { batteryPct: 64, at: recent() },
    });
    expect(panel().getByText('64%')).toBeTruthy();

    feed({
      seq: 102,
      type: 'device.label',
      deviceId: 'd-9',
      payload: { holder: { name: 'Tran B' } },
    });
    expect(await marker('TL-0009, Tran B')).toBeTruthy();

    feed({
      seq: 103,
      type: 'incident.changed',
      deviceId: 'd-9',
      payload: { incidentId: 'i-1', state: 'NOTIFY_PRIMARY' },
    });
    expect(await marker('TL-0009, Tran B, SOS, state Notifying primary')).toBeTruthy();
    expect(panel().getByText('1 device, 1 SOS open, 0 stale')).toBeTruthy();
    expect(panel().getByRole('link', { name: 'Open incident' }).getAttribute('href')).toBe(
      '/o/incidents/i-1',
    );

    feed({ seq: 104, type: 'device.released', deviceId: 'd-9', payload: {} });
    await waitFor(() => expect(screen.queryByRole('img', { name: /TL-0009/ })).toBeNull());
    expect(
      panel().getByText(
        'No devices are out on rent. Devices appear here from handover to check-in.',
      ),
    ).toBeTruthy();
  });

  it('keeps an entry that arrives before the snapshot and applies it once the cursor is known', async () => {
    let answer: (value: MapSnapshot) => void = () => undefined;
    api.mockImplementation((path: string) =>
      path.startsWith('/map/snapshot')
        ? new Promise<MapSnapshot>((resolve) => {
            answer = resolve;
          })
        : respond(path),
    );
    show('o');
    expect(screen.getByLabelText('Loading the map')).toBeTruthy();
    await waitFor(() => expect(listeners.size).toBe(1));
    feed({
      seq: 99,
      type: 'device.telemetry',
      deviceId: 'd-9',
      payload: { batteryPct: 1, at: recent() },
    });
    feed({
      seq: 101,
      type: 'device.telemetry',
      deviceId: 'd-9',
      payload: { batteryPct: 33, at: recent() },
    });
    await act(async () => answer(snapshot));
    expect(await panel().findByText('33%')).toBeTruthy();
  });

  it('reloads the snapshot when a device is handed over', async () => {
    show('o');
    await marker('TL-0009, Le Thi E');
    snapshot = {
      cursor: 120,
      devices: [device(), device({ id: 'd-10', assetTag: 'TL-0010', holder: null })],
      fieldStations: [],
    };
    feed({ seq: 110, type: 'device.handedOver', deviceId: 'd-10', payload: { contractId: 'c-1' } });
    expect(await marker('TL-0010, No holder')).toBeTruthy();
  });

  it('shows a silent device as stale and a device without a position in the list only', async () => {
    const old = new Date(Date.now() - 3_600_000).toISOString();
    snapshot.devices = [
      device({ lastSeenAt: old, position: { lat: 11.5, lon: 108.5, at: old } }),
      device({ id: 'd-2', assetTag: 'TL-0002', position: null, lastSeenAt: null, holder: null }),
    ];
    show('o');
    expect(await marker('TL-0009, Le Thi E')).toBeTruthy();
    expect(panel().getByText('2 devices, 0 SOS open, 1 stale')).toBeTruthy();
    expect(panel().getByText(/^Stale, last seen/)).toBeTruthy();
    expect(panel().getByText('No position yet')).toBeTruthy();
    expect(screen.queryByRole('img', { name: /TL-0002/ })).toBeNull();
  });

  it('searches the list and centres the map on a chosen row', async () => {
    snapshot.devices = [
      device(),
      device({ id: 'd-2', assetTag: 'TL-0002', holder: { name: 'Pham C' } }),
    ];
    show('o');
    await marker('TL-0002, Pham C');
    fireEvent.change(screen.getByLabelText('Search devices'), { target: { value: 'pham' } });
    expect(panel().queryByText('Le Thi E')).toBeNull();
    fireEvent.click(panel().getByRole('button', { name: /^TL-0002/ }));
    await waitFor(() =>
      expect(document.querySelector('.leaflet-popup-content')?.textContent).toContain('Pham C'),
    );
    fireEvent.change(screen.getByLabelText('Search devices'), { target: { value: 'nobody' } });
    expect(panel().getByText('No results match your filters.')).toBeTruthy();
  });

  it.each(['o', 't'] as const)(
    'opens the telemetry history of %s scope from the marker popup, carrying the asset tag',
    async (scope) => {
      showWithHistory(scope);
      fireEvent.click((await marker('TL-0009, Le Thi E')).parentElement as HTMLElement);
      fireEvent.click(await screen.findByRole('link', { name: 'Position history' }));
      expect(
        await screen.findByText(`history /${scope}/devices/d-9/telemetry d-9 TL-0009`),
      ).toBeTruthy();
    },
  );

  it('shows the reconnecting banner while the stream is paused', async () => {
    show('o');
    await marker('TL-0009, Le Thi E');
    push({ kind: 'paused', paused: true });
    expect(screen.getByRole('alert').textContent).toContain('Reconnecting. Live data is paused.');
    push({ kind: 'paused', paused: false });
    expect(screen.queryByText('Reconnecting. Live data is paused.')).toBeNull();
  });

  it('filters the fleet map by organization', async () => {
    show('t');
    await marker('TL-0009, Le Thi E');
    expect(api).toHaveBeenCalledWith('/map/snapshot');
    const filter = await screen.findByLabelText('Organization');
    await screen.findByRole('option', { name: 'ORG-0002 Other Trek' });
    snapshot = { cursor: 100, devices: [], fieldStations: [] };
    fireEvent.change(filter, { target: { value: 'org-2' } });
    await waitFor(() => expect(api).toHaveBeenCalledWith('/map/snapshot?organizationId=org-2'));
    expect(await panel().findByText('No results match your filters.')).toBeTruthy();
  });

  it('offers the whole fleet back when the filter is refused', async () => {
    show('t');
    await marker('TL-0009, Le Thi E');
    await screen.findByRole('option', { name: 'ORG-0002 Other Trek' });
    snapshotError = new ApiError(400, 'VALIDATION_FAILED', 'organizationId must be a UUID');
    fireEvent.change(screen.getByLabelText('Organization'), { target: { value: 'org-2' } });
    expect(await screen.findByText('organizationId must be a UUID')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show all organizations' }));
    await waitFor(() => expect(screen.queryByText('organizationId must be a UUID')).toBeNull());
    expect((screen.getByLabelText('Organization') as HTMLSelectElement).value).toBe('');
    expect(await marker('TL-0009, Le Thi E')).toBeTruthy();
  });

  it('offers a reload after another error, and MSG26 when refused', async () => {
    snapshotError = new ApiError(500, 'INTERNAL', 'Something broke.');
    const { unmount } = show('o');
    expect(await screen.findByText('Something broke.')).toBeTruthy();
    snapshotError = null;
    fireEvent.click(screen.getByRole('button', { name: 'Reload map' }));
    expect(await marker('TL-0009, Le Thi E')).toBeTruthy();
    unmount();

    snapshotError = new ApiError(403, 'FORBIDDEN', 'You do not have access to this.');
    show('o');
    expect((await screen.findByRole('alert')).textContent).toBe('You do not have access to this.');
  });
});
