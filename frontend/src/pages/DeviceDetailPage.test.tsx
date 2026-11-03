// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../shared/api/apiClient';
import { DeviceDetailPage } from './DeviceDetailPage';
import { useConnectorStore } from '../features/device-connector/model/connectorStore';

const recordIntakeCheck = vi.fn();
const recordReset = vi.fn();
const retireDevice = vi.fn();
const disposeDevice = vi.fn();
const editFirmware = vi.fn();

const device = (overrides: Record<string, unknown> = {}) => ({
  id: 'd-1',
  assetTag: 'TL-0042',
  nodeNum: 2763113171,
  nodeId: '!a4b1c2d3',
  hardwareVariant: {
    id: 'v-3',
    code: 'treklink-v3',
    name: 'TrekLink v3',
    imageUrl: null,
    specSheet: { mcu: 'ESP32', localAlarm: 'LED blinks' },
    hasGps: true,
    hasMotionSensor: true,
    mqttCapable: true,
    firmwareBaseline: '2.7.19-treklink.3',
  },
  firmwareVersion: '2.7.19-treklink.3',
  acquiredAt: '2026-06-15T00:00:00Z',
  status: 'IN_INTAKE',
  statusChangedAt: '2026-10-20T03:15:00.000Z',
  keyVersion: null,
  keyOrganizationId: null,
  keyOrganization: null,
  batteryPct: null,
  lastSeenAt: null,
  lastPosition: null,
  serviceDueAt: null,
  version: 0,
  openMaintenance: null,
  lastIntakeCheck: null,
  lastReset: null,
  ...overrides,
});

let currentDevice = device();
type HistoryPage = { items: unknown[]; pageNumber: number; pageSize: number; totalCount: number; totalPages: number };
let historyPages: (page: number) => HistoryPage = () => ({ items: [], pageNumber: 1, pageSize: 20, totalCount: 0, totalPages: 0 });
let currentRoles = ['STAFF'];

// The small position map asks for the map config; the device tests read the coordinates under it.
vi.mock('../shared/config/map', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/config/map')>()),
  getMapConfig: () => new Promise(() => undefined),
}));

vi.mock('../app/providers/useAuth', () => ({
  useAuth: () => ({ user: { id: 'staff-1', roles: currentRoles } }),
}));

vi.mock('../entities/device/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../entities/device/api')>()),
  useDevice: () => ({ data: currentDevice, isLoading: false, error: null, refetch: vi.fn() }),
  useDeviceHistory: (_id: string, page: number) => ({ data: historyPages(page) }),
  recordIntakeCheck: (...args: unknown[]) => recordIntakeCheck(...args),
  recordReset: (...args: unknown[]) => recordReset(...args),
  retireDevice: (...args: unknown[]) => retireDevice(...args),
  disposeDevice: (...args: unknown[]) => disposeDevice(...args),
  editFirmware: (...args: unknown[]) => editFirmware(...args),
}));

// The history route of screen 9.2, standing in for the page: it shows where the link led.
const HistoryProbe: React.FC = () => {
  const { pathname, state } = useLocation();
  return (
    <p>
      history {pathname} {(state as { assetTag?: string } | null)?.assetTag}
    </p>
  );
};

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/t/devices/d-1']}>
        <Routes>
          <Route path="/t/devices/:id" element={<DeviceDetailPage />} />
          <Route path="/t/devices/:id/telemetry" element={<HistoryProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  recordIntakeCheck.mockReset();
  recordReset.mockReset();
  retireDevice.mockReset();
  disposeDevice.mockReset();
  editFirmware.mockReset();
  currentRoles = ['STAFF'];
  currentDevice = device();
  historyPages = () => ({ items: [], pageNumber: 1, pageSize: 20, totalCount: 0, totalPages: 0 });
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window.navigator, 'serial');
});

describe('DeviceDetailPage (/t/devices/:id, screen 4.2)', () => {
  it('keeps one h1 and a 24 px Back link when the device cannot be read (review of treklink-web#355)', () => {
    currentDevice = undefined as unknown as ReturnType<typeof device>;
    renderPage();
    expect(screen.getAllByRole('heading', { level: 1 }).map((heading) => heading.textContent)).toEqual(['Device']);
    expect(screen.getByRole('link', { name: 'Back to devices' }).className).toContain('min-h-6');
  });

  it('reads TrekLink as the holder of a unit in intake, and says when nothing was reported', async () => {
    renderPage();
    const facts = (await screen.findByText('Holder')).closest('dl') as HTMLElement;
    expect(within(facts).getByText('TrekLink')).toBeTruthy();
    expect(within(facts).getByText('Not reported')).toBeTruthy();
    expect(within(facts).getByText('Never heard')).toBeTruthy();
  });

  it('shows the header facts', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'TL-0042' })).toBeTruthy();
    expect(screen.getByText('!a4b1c2d3 (2763113171)')).toBeTruthy();
    expect(screen.getByText('treklink-v3')).toBeTruthy();
    // W15 panel walk: the acquired date read 15/06/2026 beside dates written 15 Jun 2026 elsewhere.
    expect(screen.getByText('15 Jun 2026')).toBeTruthy();
  });

  it('shows the last position on a small map with the coordinates under it (W20B item 1)', async () => {
    currentDevice = device({ lastPosition: { lat: 11.5612345, lon: 108.5401 } });
    renderPage();
    const section = await screen.findByRole('region', { name: 'Last position' });
    expect(within(section).getByText('11.56123, 108.54010')).toBeTruthy();
    expect(within(section).getByText('Loading map')).toBeTruthy();
  });

  it('says the position is unavailable when the unit never reported one', async () => {
    renderPage();
    const section = await screen.findByRole('region', { name: 'Last position' });
    expect(within(section).getByText('Position unavailable')).toBeTruthy();
  });

  it('links each history row to what it names and leaves the rest as text (W20B item 2)', async () => {
    const row = (summary: string, refType: string | null, refId: string | null) => ({
      at: '2026-10-20T03:15:00.000Z',
      kind: 'STATE',
      summary,
      actor: 'SYSTEM',
      refType,
      refId,
    });
    historyPages = () => ({
      items: [
        row('Handed over on RC-2026-0001 (ORG-0001)', 'CONTRACT', 'c-1'),
        row('From Rented to Lost (Loss reported)', 'LOSS_CASE', 'l-1'),
        row('Incident INC-2026-000001 opened (Detected)', 'INCIDENT', 'i-1'),
        row('Maintenance opened: Staff reported', 'MAINTENANCE', 'm-1'),
        row('From Returned to Available (Inspection pass)', 'INSPECTION', 'in-1'),
      ],
      pageNumber: 1,
      pageSize: 20,
      totalCount: 5,
      totalPages: 1,
    });
    renderPage();
    const history = await screen.findByRole('region', { name: 'History' });
    const href = (name: string) => within(history).getByRole('link', { name }).getAttribute('href');
    expect(href('Handed over on RC-2026-0001 (ORG-0001)')).toBe('/t/contracts/c-1');
    expect(href('From Rented to Lost (Loss reported)')).toBe('/t/loss-cases/l-1');
    expect(href('Incident INC-2026-000001 opened (Detected)')).toBe('/t/incidents/i-1');
    expect(href('Maintenance opened: Staff reported')).toBe('/t/maintenance');
    expect(within(history).queryByRole('link', { name: 'From Returned to Available (Inspection pass)' })).toBeNull();
    expect(within(history).getByText('From Returned to Available (Inspection pass)')).toBeTruthy();
    // One page only: no pager.
    expect(within(history).queryByRole('navigation', { name: 'Pages' })).toBeNull();
  });

  it('pages the history 20 rows at a time', async () => {
    historyPages = (page) => ({
      items: [
        { at: '2026-10-20T03:15:00.000Z', kind: 'INTAKE', summary: `Row on page ${page}`, actor: 'SYSTEM', refType: null, refId: null },
      ],
      pageNumber: page,
      pageSize: 20,
      totalCount: 25,
      totalPages: 2,
    });
    renderPage();
    const history = await screen.findByRole('region', { name: 'History' });
    expect(within(history).getByText('Row on page 1')).toBeTruthy();
    fireEvent.click(within(history).getByRole('button', { name: 'Next page' }));
    expect(await within(history).findByText('Row on page 2')).toBeTruthy();
  });

  it('shows the detail render of the variant on the device page (devices design section 10)', async () => {
    currentDevice = device({
      hardwareVariant: { ...device().hardwareVariant, imageUrl: '/variants/treklink-v3-detail.png' },
    });
    renderPage();
    const image = await screen.findByRole('img', { name: 'TrekLink v3 unit' });
    expect(image.getAttribute('src')).toBe('/variants/treklink-v3-detail.png');
    expect(image.getAttribute('width')).toBe('160');
  });

  it("shows the card of the unit's variant with its spec sheet and the empty image slot", async () => {
    renderPage();
    expect(await screen.findByRole('heading', { level: 2, name: 'TrekLink v3' })).toBeTruthy();
    expect(screen.getByText('LED blinks')).toBeTruthy();
    expect(screen.getByText('Variant image not added yet')).toBeTruthy();
  });

  it('shows the capability flags of the variant on the card, from the unit payload', async () => {
    renderPage();
    expect(await screen.findByText('Capabilities')).toBeTruthy();
    expect(screen.getByText('GPS, Motion sensor, MQTT')).toBeTruthy();
    expect(screen.getByText('Firmware baseline')).toBeTruthy();
  });

  it.each(['IN_INTAKE', 'AVAILABLE', 'RENTED', 'RETIRED', 'DISPOSED'] as const)(
    'links a %s device to its position history, carrying the asset tag',
    async (status) => {
      currentDevice = device({ status });
      renderPage();
      fireEvent.click(await screen.findByRole('link', { name: 'Position history' }));
      expect(await screen.findByText('history /t/devices/d-1/telemetry TL-0042')).toBeTruthy();
    },
  );

  // D-092 rule 4 (devices REQ-EVT-23): the path back to AVAILABLE as the next step on the page.
  it('shows the next step of a returned unit with a link to the counter of its contract', async () => {
    currentDevice = device({
      status: 'RETURNED',
      nextStep: { action: 'INSPECT', contractId: 'c-4' },
    });
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Next step: Inspect' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open the counter' }).getAttribute('href')).toBe(
      '/t/counter/c-4',
    );
  });

  it('points a unit out of maintenance at the intake check on this page, and shows nothing once available', async () => {
    currentDevice = device({
      status: 'MAINTENANCE',
      nextStep: { action: 'INTAKE', contractId: null },
    });
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Next step: Intake check' })).toBeTruthy();
    expect(screen.getByText('Record an intake check on this page. A pass makes it available.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Record intake check' })).toBeTruthy();
    cleanup();

    currentDevice = device({ status: 'AVAILABLE', nextStep: null });
    renderPage();
    await screen.findByRole('heading', { name: 'TL-0042' });
    expect(screen.queryByRole('heading', { name: /Next step/ })).toBeNull();
  });

  it('names the open maintenance record by its readable status', async () => {
    currentDevice = device({
      status: 'MAINTENANCE',
      openMaintenance: { id: 'm-1', status: 'OPEN', description: 'Antenna loose' },
    });
    renderPage();
    const link = await screen.findByRole('link', { name: 'Open, Antenna loose' });
    expect(link.getAttribute('href')).toBe('/t/maintenance');
    expect(screen.queryByText(/OPEN, Antenna loose/)).toBeNull();
  });

  it('records an intake check with the motion field for a motion variant', async () => {
    recordIntakeCheck.mockResolvedValue({ check: { passed: true }, device: device() });
    renderPage();
    await screen.findByRole('heading', { name: 'TL-0042' });
    fireEvent.click(screen.getByRole('button', { name: 'Record intake check' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('Motion sensor')).toBeTruthy();
    fireEvent.click(dialog.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(recordIntakeCheck).toHaveBeenCalledWith('d-1', {
        gpsFixOk: true,
        radioOk: true,
        batteryOk: true,
        motionOk: true,
        expectedVersion: 0,
      }),
    );
  });

  it('shows MAINTENANCE_OPEN as a dependency message', async () => {
    recordIntakeCheck.mockRejectedValueOnce(
      new ApiError(409, 'MAINTENANCE_OPEN', 'Finish the open maintenance record first.'),
    );
    renderPage();
    await screen.findByRole('heading', { name: 'TL-0042' });
    fireEvent.click(screen.getByRole('button', { name: 'Record intake check' }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.click(dialog.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Finish the open maintenance record first.')).toBeTruthy();
  });

  it('enables reset only once every step is ticked, for a RETURNED unit', async () => {
    currentDevice = device({ status: 'RETURNED', version: 2 });
    recordReset.mockResolvedValue(device({ status: 'MAINTENANCE' }));
    renderPage();
    await screen.findByRole('heading', { name: 'TL-0042' });
    fireEvent.click(screen.getByRole('button', { name: 'Record reset' }));
    const dialog = within(screen.getByRole('dialog'));
    const save = dialog.getByRole('button', { name: 'Save' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(dialog.getByLabelText('Key removed'));
    fireEvent.click(dialog.getByLabelText('Node database cleared'));
    fireEvent.click(dialog.getByLabelText('Owner cleared'));
    expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(recordReset).toHaveBeenCalledWith('d-1'));
  });

  it('offers Report lost on a device in service only (screen 4.4)', async () => {
    currentDevice = device({ status: 'RENTED' });
    renderPage();
    await screen.findByRole('heading', { name: 'TL-0042' });
    fireEvent.click(screen.getByRole('button', { name: 'Report lost' }));
    expect(screen.getByRole('dialog', { name: 'Report TL-0042 lost' })).toBeTruthy();
    cleanup();
    currentDevice = device({ status: 'LOST' });
    renderPage();
    await screen.findByRole('heading', { name: 'TL-0042' });
    expect(screen.queryByRole('button', { name: 'Report lost' })).toBeNull();
  });

  it('shows retire and dispose only for an Admin, in the right states', async () => {
    currentRoles = ['ADMIN'];
    currentDevice = device({ status: 'MAINTENANCE' });
    renderPage();
    await screen.findByRole('heading', { name: 'TL-0042' });
    expect(screen.getByRole('button', { name: 'Retire' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Dispose' })).toBeNull();
  });

  it('retires a device with a reason', async () => {
    currentRoles = ['ADMIN'];
    currentDevice = device({ status: 'MAINTENANCE', version: 4 });
    retireDevice.mockResolvedValue(device({ status: 'RETIRED' }));
    renderPage();
    await screen.findByRole('heading', { name: 'TL-0042' });
    fireEvent.click(screen.getByRole('button', { name: 'Retire' }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.click(dialog.getByRole('button', { name: 'Retire' }));
    expect(await dialog.findByText('Please fill in this field.')).toBeTruthy();
    fireEvent.change(dialog.getByLabelText(/Reason/), { target: { value: 'Unrepairable water damage' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Retire' }));
    await waitFor(() =>
      expect(retireDevice).toHaveBeenCalledWith('d-1', 'Unrepairable water damage', 4),
    );
  });

  it('disposes of a RETIRED device once the wipe steps and method are filled', async () => {
    currentRoles = ['ADMIN'];
    currentDevice = device({ status: 'RETIRED', version: 7 });
    disposeDevice.mockResolvedValue(device({ status: 'DISPOSED' }));
    renderPage();
    await screen.findByRole('heading', { name: 'TL-0042' });
    fireEvent.click(screen.getByRole('button', { name: 'Dispose' }));
    // Disposal cannot be undone: an alert dialog (UI standard §3).
    const dialog = within(screen.getByRole('alertdialog', { name: 'Dispose of TL-0042?' }));
    const disposeButton = dialog.getByRole('button', { name: 'Dispose' });
    expect((disposeButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(dialog.getByLabelText('Key removed'));
    fireEvent.click(dialog.getByLabelText('Node database cleared'));
    fireEvent.click(dialog.getByLabelText('Owner cleared'));
    fireEvent.change(dialog.getByLabelText(/Method/), { target: { value: 'Recycled by vendor' } });
    fireEvent.click(disposeButton);
    await waitFor(() =>
      expect(disposeDevice).toHaveBeenCalledWith(
        'd-1',
        { keyRemoved: true, nodeDbCleared: true, ownerCleared: true },
        'Recycled by vendor',
        7,
      ),
    );
  });

  it('shows the server refusal when the retire is stale', async () => {
    currentRoles = ['ADMIN'];
    currentDevice = device({ status: 'MAINTENANCE', version: 4 });
    retireDevice.mockRejectedValue(
      new ApiError(409, 'STALE_VERSION', 'This was changed by someone else. Reload and try again.'),
    );
    renderPage();
    await screen.findByRole('heading', { name: 'TL-0042' });
    fireEvent.click(screen.getByRole('button', { name: 'Retire' }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText(/Reason/), { target: { value: 'Cracked casing' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Retire' }));
    expect(
      await dialog.findByText('This was changed by someone else. Reload and try again.'),
    ).toBeTruthy();
  });

  it('disables Retire while a maintenance record is open, and says why', async () => {
    currentRoles = ['ADMIN'];
    currentDevice = device({
      status: 'MAINTENANCE',
      version: 4,
      openMaintenance: { id: 'm-1', status: 'OPEN', description: 'Antenna loose' },
    });
    renderPage();
    await screen.findByRole('heading', { name: 'TL-0042' });
    const retire = screen.getByRole('button', { name: 'Retire' }) as HTMLButtonElement;
    expect(retire.disabled).toBe(true);
    const hint = document.getElementById(retire.getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toBe('Finish the open maintenance record first.');
    fireEvent.click(retire);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(retireDevice).not.toHaveBeenCalled();
  });

  it('asks to finish the open maintenance record when retire answers MAINTENANCE_OPEN', async () => {
    currentRoles = ['ADMIN'];
    currentDevice = device({ status: 'MAINTENANCE', version: 4 });
    retireDevice.mockRejectedValue(
      new ApiError(409, 'MAINTENANCE_OPEN', 'Finish the open maintenance record first.'),
    );
    renderPage();
    await screen.findByRole('heading', { name: 'TL-0042' });
    fireEvent.click(screen.getByRole('button', { name: 'Retire' }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText(/Reason/), { target: { value: 'Cracked casing' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Retire' }));
    expect(await dialog.findByText('Finish the open maintenance record first.')).toBeTruthy();
  });

  it('shows WIPE_INCOMPLETE from the server on the dispose dialog', async () => {
    currentRoles = ['ADMIN'];
    currentDevice = device({ status: 'RETIRED', version: 7 });
    disposeDevice.mockRejectedValue(
      new ApiError(400, 'WIPE_INCOMPLETE', 'Complete every wipe step first.'),
    );
    renderPage();
    await screen.findByRole('heading', { name: 'TL-0042' });
    fireEvent.click(screen.getByRole('button', { name: 'Dispose' }));
    // Disposal cannot be undone: an alert dialog (UI standard §3).
    const dialog = within(screen.getByRole('alertdialog', { name: 'Dispose of TL-0042?' }));
    fireEvent.click(dialog.getByLabelText('Key removed'));
    fireEvent.click(dialog.getByLabelText('Node database cleared'));
    fireEvent.click(dialog.getByLabelText('Owner cleared'));
    fireEvent.change(dialog.getByLabelText(/Method/), { target: { value: 'Recycled by vendor' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Dispose' }));
    expect(await dialog.findByText('Complete every wipe step first.')).toBeTruthy();
  });

  it('never offers intake, reset, retire or dispose outside their states', async () => {
    currentDevice = device({ status: 'RENTED' });
    renderPage();
    await screen.findByRole('heading', { name: 'TL-0042' });
    expect(screen.queryByRole('button', { name: 'Record intake check' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Record reset' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retire' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dispose' })).toBeNull();
  });

  it('opens the hub for Configure uplink with Web Serial, not for a retired unit, and not without it (design 8.8, 11.7)', async () => {
    renderPage();
    expect(screen.queryByRole('button', { name: 'Configure uplink' })).toBeNull();
    cleanup();

    Object.defineProperty(window.navigator, 'serial', { value: {}, configurable: true });
    currentDevice = device({ status: 'AVAILABLE', keyVersion: 2 });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Configure uplink' }));
    // The dialog lives in the device connector now (devices design section 11.7): the button opens the
    // hub focused on this unit's uplink.
    expect(useConnectorStore.getState()).toMatchObject({
      open: true,
      focus: { action: 'uplink', assetTag: 'TL-0042' },
    });
    expect(screen.queryByRole('dialog', { name: 'Configure TL-0042 as an uplink' })).toBeNull();
    useConnectorStore.setState({ open: false, focus: null });
    cleanup();

    currentDevice = device({ status: 'RETIRED' });
    renderPage();
    expect(screen.queryByRole('button', { name: 'Configure uplink' })).toBeNull();
  });
});

// Below 600 px (chapter 06 §10.5, handoff item 7): a matchMedia that answers for a 360 px window.
describe('DeviceDetailPage at 360 px', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0) <= 360,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('puts the facts before the variant render on the first screen (W20B item 3)', async () => {
    currentDevice = device({
      status: 'RENTED',
      batteryPct: 81,
      lastSeenAt: '2026-11-04T02:00:00.000Z',
      keyVersion: 1,
      keyOrganization: { id: 'o-1', code: 'ORG-0001', legalName: 'Lam Vien Trekking' },
    });
    renderPage();
    const facts = (await screen.findByText('Holder')).closest('dl') as HTMLElement;
    const render = screen.getByRole('heading', { level: 2, name: 'TrekLink v3' });
    // The facts come first in the document, the variant card after them.
    expect(facts.compareDocumentPosition(render) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const labels = Array.from(facts.querySelectorAll('dt')).slice(0, 3).map((term) => term.textContent);
    expect(labels).toEqual(['Holder', 'Battery', 'Last seen']);
    expect(within(facts).getByText('Lam Vien Trekking (ORG-0001)')).toBeTruthy();
    expect(within(facts).getByText('81%')).toBeTruthy();
  });

  it('pins the actions to the bottom: the primary action widest, the rest under More actions', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'TL-0042' });
    const bar = screen.getByRole('group', { name: 'Device actions' });
    expect(bar.hasAttribute('data-page-actions')).toBe(true);
    expect(within(bar).getByRole('button', { name: 'Record intake check' }).className).toContain('flex-1');
    fireEvent.click(within(bar).getByRole('button', { name: /^More actions/ }));
    const items = screen.getAllByRole('menuitem').map((item) => item.textContent);
    // Destructive ones last, after a separator.
    expect(items).toEqual(['Edit firmware', 'Position history', 'Report lost']);
    expect(screen.getByRole('separator')).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Position history' }));
    expect(await screen.findByText('history /t/devices/d-1/telemetry TL-0042')).toBeTruthy();
  });

  it('keeps an unavailable action in More actions with its reason', async () => {
    currentRoles = ['ADMIN'];
    currentDevice = device({
      status: 'MAINTENANCE',
      version: 4,
      openMaintenance: { id: 'm-1', status: 'OPEN', description: 'Antenna loose' },
    });
    renderPage();
    await screen.findByRole('heading', { name: 'TL-0042' });
    const bar = screen.getByRole('group', { name: 'Device actions' });
    // No primary step is due, so the first plain action leads.
    expect(within(bar).getByRole('button', { name: 'Edit firmware' })).toBeTruthy();
    fireEvent.click(within(bar).getByRole('button', { name: /^More actions/ }));
    const retire = screen.getByRole('menuitem', { name: 'Retire' });
    expect(retire.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(retire.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'Finish the open maintenance record first.',
    );
    fireEvent.click(retire);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
