// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../shared/api/apiClient';
import { FleetPage } from './FleetPage';

const registerDevice = vi.fn();
const retireDevice = vi.fn();
const recordReset = vi.fn();

// The docking hook is the feature's (tested in features/dock-device); the page test drives its answers.
const docking = vi.hoisted(() => ({
  supported: true,
  busy: false,
  state: { target: null, stage: null },
  readUnit: vi.fn(),
  dockAndProvision: vi.fn(),
  configureUplink: vi.fn(),
  reconnect: vi.fn(),
  giveUp: vi.fn(),
}));
vi.mock('../features/device-connector/actions/useDocking', () => ({ useDocking: () => docking }));

let roles = ['STAFF'];
vi.mock('../app/providers/useAuth', () => ({ useAuth: () => ({ user: { roles } }) }));

const VARIANT = {
  id: 'v-3',
  code: 'treklink-v3',
  name: 'TrekLink v3',
  hasGps: true,
  hasMotionSensor: false,
  mqttCapable: true,
  firmwareBaseline: '2.7.19-treklink.3',
  remainingValueSchedule: [],
  serviceIntervalDays: 180,
  serviceChecklist: [],
  isActive: true,
};

const device = (overrides: Record<string, unknown> = {}) => ({
  id: 'd-1',
  assetTag: 'TL-0042',
  nodeNum: 2763113171,
  nodeId: '!a4b1c2d3',
  hardwareVariant: {
    id: 'v-3',
    code: 'treklink-v3',
    name: 'TrekLink v3',
    imageUrl: '/variants/treklink-v3-detail.png',
    specSheet: { mcu: 'ESP32' },
    hasGps: true,
    hasMotionSensor: false,
    mqttCapable: true,
    firmwareBaseline: '2.7.19-treklink.3',
  },
  firmwareVersion: '2.7.19-treklink.3',
  acquiredAt: '2026-06-15T00:00:00Z',
  status: 'AVAILABLE',
  statusChangedAt: '2026-10-20T03:15:00.000Z',
  keyVersion: null,
  keyOrganizationId: null,
  keyOrganization: null,
  batteryPct: 96,
  lastSeenAt: '2026-10-20T03:15:00.000Z',
  lastPosition: null,
  serviceDueAt: '2026-12-12',
  version: 5,
  ...overrides,
});

const page = (items: unknown[]) => ({
  items,
  pageNumber: 1,
  pageSize: 20,
  totalCount: items.length,
  totalPages: items.length > 0 ? 1 : 0,
});

let devices: unknown[] = [device()];
const seenFilters: { status?: string[]; sort?: string; order?: string; pageNumber?: number }[] = [];

vi.mock('../entities/device/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../entities/device/api')>()),
  useVariants: () => ({ data: [VARIANT] }),
  useDevices: (filters: (typeof seenFilters)[number]) => {
    seenFilters.push(filters);
    return { data: page(devices), isLoading: false, error: null, refetch: vi.fn() };
  },
  useDeviceStatusCounts: () => ({ AVAILABLE: 12, MAINTENANCE: 3 }),
  registerDevice: (...args: unknown[]) => registerDevice(...args),
  retireDevice: (...args: unknown[]) => retireDevice(...args),
  recordReset: (...args: unknown[]) => recordReset(...args),
}));

const renderPage = (path = '/t/fleet') =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/t/fleet" element={<FleetPage />} />
          <Route path="/t/devices/:id" element={<p>Device page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

const lastStatus = () => seenFilters[seenFilters.length - 1]?.status;

beforeEach(() => {
  docking.supported = true;
  docking.readUnit.mockReset();
  registerDevice.mockReset();
  devices = [device()];
  seenFilters.length = 0;
});
afterEach(cleanup);

describe('FleetPage (/t/fleet, screen 4.2)', () => {
  it('lists the fleet with its asset tag, variant, status and battery', async () => {
    renderPage();
    const table = within(await screen.findByRole('table'));
    const row = table.getByText('TL-0042').closest('tr') as HTMLElement;
    expect(within(row).getByText('treklink-v3')).toBeTruthy();
    expect(within(row).getByText('Available')).toBeTruthy();
    expect(within(row).getByText('96%')).toBeTruthy();
  });

  // W17 (devices design section 10, "Two renders per variant"): the icon in the column, the detail render
  // in the details pane.
  it('shows the icon render beside the variant code and the detail render in the details pane', async () => {
    renderPage();
    const table = within(await screen.findByRole('table'));
    const row = table.getByText('TL-0042').closest('tr') as HTMLElement;
    const icon = within(row).getByRole('img', { name: 'TrekLink v3 unit' });
    expect(icon.getAttribute('src')).toBe('/variants/treklink-v3-icon.png');
    expect(icon.getAttribute('width')).toBe('32');

    fireEvent.click(screen.getByRole('button', { name: 'Show details of TL-0042' }));
    const pane = within(screen.getByRole('complementary', { name: 'TL-0042' }));
    expect(pane.getByRole('img', { name: 'TrekLink v3 unit' }).getAttribute('src')).toBe(
      '/variants/treklink-v3-detail.png',
    );
    expect(pane.getByRole('heading', { level: 3, name: 'TrekLink v3' })).toBeTruthy();
    // One image in the pane: the Variant field and its icon stay in the table.
    expect(pane.getAllByRole('img')).toHaveLength(1);
  });

  // W15 panel walk: the asset tag broke at its hyphen (TL- / 0002) and the service date read 2027-05-03
  // beside dates written 04 Nov 2026 everywhere else.
  it('keeps the asset tag on one line and writes the service date as every other date', async () => {
    renderPage();
    const table = within(await screen.findByRole('table'));
    const tag = table.getByText('TL-0042');
    expect(tag.className).toContain('whitespace-nowrap');
    const row = tag.closest('tr') as HTMLElement;
    expect(within(row).getByText('12 Dec 2026')).toBeTruthy();
    expect(within(row).queryByText('2026-12-12')).toBeNull();
  });

  it('opens the register dialog and submits the form', async () => {
    registerDevice.mockResolvedValue(device({ id: 'd-new', assetTag: 'TL-0099' }));
    renderPage();
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Register device' }));

    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText(/Asset tag/), { target: { value: 'TL-0099' } });
    fireEvent.change(dialog.getByLabelText(/Node number/), { target: { value: '2763113172' } });
    fireEvent.change(dialog.getByLabelText(/Hardware variant/), { target: { value: 'v-3' } });
    fireEvent.change(dialog.getByLabelText(/Acquired on/), { target: { value: '2026-06-15' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Register device' }));

    await waitFor(() => expect(registerDevice).toHaveBeenCalledWith(
      expect.objectContaining({ assetTag: 'TL-0099', nodeNum: '2763113172', hardwareVariantId: 'v-3' }),
    ));
    // The new device opens on its own page, in IN_INTAKE, for the intake check.
    expect(await screen.findByText('Device page')).toBeTruthy();
  });

  it('shows the conflict message under the form on CONFLICT_UNIQUE', async () => {
    registerDevice.mockRejectedValueOnce(
      new ApiError(409, 'CONFLICT_UNIQUE', 'TL-0099 is already registered.'),
    );
    renderPage();
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Register device' }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText(/Asset tag/), { target: { value: 'TL-0099' } });
    fireEvent.change(dialog.getByLabelText(/Node number/), { target: { value: '1' } });
    fireEvent.change(dialog.getByLabelText(/Hardware variant/), { target: { value: 'v-3' } });
    fireEvent.change(dialog.getByLabelText(/Acquired on/), { target: { value: '2026-06-15' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Register device' }));
    expect(await screen.findByText('TL-0099 is already registered.')).toBeTruthy();
  });

  it('flags required fields left blank', async () => {
    renderPage();
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Register device' }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.click(dialog.getByRole('button', { name: 'Register device' }));
    expect(await screen.findAllByText('Please fill in this field.')).not.toHaveLength(0);
    expect(registerDevice).not.toHaveBeenCalled();
  });

  it('shows a count on each status chip and filters on the chips pressed', async () => {
    renderPage();
    await screen.findByRole('table');
    const chips = within(screen.getByRole('group', { name: 'Filter by status' }));
    const maintenance = chips.getByRole('button', { name: /Maintenance/ });
    expect(maintenance.textContent).toContain('3');
    expect(maintenance.getAttribute('aria-pressed')).toBe('false');
    expect(lastStatus()).toBeUndefined();

    fireEvent.click(maintenance);
    await waitFor(() => expect(lastStatus()).toEqual(['MAINTENANCE']));
    expect(maintenance.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(chips.getByRole('button', { name: /Lost/ }));
    await waitFor(() => expect(lastStatus()).toEqual(['MAINTENANCE', 'LOST']));
  });

  it('reads the status filter from the address', async () => {
    renderPage('/t/fleet?status=MAINTENANCE&status=BOGUS');
    await screen.findByRole('table');
    expect(lastStatus()).toEqual(['MAINTENANCE']);
    const chips = within(screen.getByRole('group', { name: 'Filter by status' }));
    expect(chips.getByRole('button', { name: /Maintenance/ }).getAttribute('aria-pressed')).toBe('true');
  });

  // W26: the headers sort on the server (devices api-design 06); the asset tag is the default order.
  it('sends the header sort to the fleet query and keeps it in the address', async () => {
    renderPage();
    const table = within(await screen.findByRole('table'));
    const last = () => seenFilters[seenFilters.length - 1];
    expect(last()).not.toHaveProperty('sort');
    expect(table.getByRole('button', { name: 'Device' }).closest('th')!.getAttribute('aria-sort')).toBe(
      'ascending',
    );
    fireEvent.click(table.getByRole('button', { name: 'Last seen' }));
    await waitFor(() => expect(last()).toMatchObject({ sort: 'lastSeenAt', order: 'asc', pageNumber: 1 }));
    fireEvent.click(table.getByRole('button', { name: 'Last seen' }));
    await waitFor(() => expect(last()).toMatchObject({ sort: 'lastSeenAt', order: 'desc' }));
    // The third click returns to the default order, the asset tag, which sends no sort.
    fireEvent.click(table.getByRole('button', { name: 'Last seen' }));
    await waitFor(() => expect(last()).not.toHaveProperty('sort'));
    fireEvent.click(table.getByRole('button', { name: 'Device' }));
    await waitFor(() => expect(last()).toMatchObject({ sort: 'assetTag', order: 'desc' }));
    fireEvent.click(table.getByRole('button', { name: 'Device' }));
    await waitFor(() => expect(last()).not.toHaveProperty('sort'));
  });

  it('reads the sort from the address and ignores a field off the allowlist', async () => {
    renderPage('/t/fleet?sort=batteryPct&order=desc');
    const table = within(await screen.findByRole('table'));
    expect(seenFilters[seenFilters.length - 1]).toMatchObject({ sort: 'batteryPct', order: 'desc' });
    expect(table.getByRole('button', { name: 'Battery' }).closest('th')!.getAttribute('aria-sort')).toBe(
      'descending',
    );
    cleanup();
    seenFilters.length = 0;
    renderPage('/t/fleet?sort=firmwareVersion');
    await screen.findByRole('table');
    expect(seenFilters[seenFilters.length - 1]).not.toHaveProperty('sort');
  });

  it('marks exactly the allowlisted columns sortable', async () => {
    renderPage();
    const table = within(await screen.findByRole('table'));
    const sortable = table
      .getAllByRole('columnheader')
      .filter((header) => header.querySelector('button[type="button"]') && header.querySelector('[data-sort-icon]'))
      .map((header) => header.textContent);
    expect(sortable).toEqual(['Device', 'Node id', 'Status', 'Battery', 'Last seen', 'Service due']);
  });

  it('shows the first-run empty state, and MSG01 once a filter is set', async () => {
    devices = [];
    renderPage();
    expect(await screen.findByText('No devices registered yet.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Available/ }));
    expect(await screen.findByText('No results match your filters.')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]);
    expect(await screen.findByText('No devices registered yet.')).toBeTruthy();
  });

  it('shows each device as a Large card: the variant render, the tag, the variant and its fields (W30)', async () => {
    // Three devices: one or two would hide the command bar and its view switch (§9.3).
    devices = [device(), device({ id: 'd-2', assetTag: 'TL-0043' }), device({ id: 'd-3', assetTag: 'TL-0044' })];
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Choose view' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Large cards' }));
    const list = within(screen.getByRole('list', { name: 'Devices' }));
    const first = within(list.getAllByRole('listitem')[0]);
    expect(first.getByRole('heading', { level: 3 }).textContent).toBe('TL-0042');
    expect((first.getByRole('img', { name: 'TrekLink v3 unit' }) as HTMLImageElement).getAttribute('src')).toBe(
      '/variants/treklink-v3-icon.png',
    );
    expect(first.getByText('TrekLink v3')).toBeTruthy();
    expect(first.getByText('GPS, MQTT')).toBeTruthy();
    expect(first.getByText('96%')).toBeTruthy();
    expect(first.getByText('Available')).toBeTruthy();
  });

  it('names battery and last seen in the label and value block of a card (W20B item 4, W30)', async () => {
    devices = [
      device({ batteryPct: null, lastSeenAt: null }),
      device({ id: 'd-2', assetTag: 'TL-0043' }),
      device({ id: 'd-3', assetTag: 'TL-0044' }),
    ];
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Choose view' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Large cards' }));
    const first = within(within(screen.getByRole('list', { name: 'Devices' })).getAllByRole('listitem')[0]);
    expect(first.getByText('Battery').tagName).toBe('DT');
    expect(first.getByText('Unknown').tagName).toBe('DD');
    expect(first.getByText('Last seen').tagName).toBe('DT');
    expect(first.getByText('Never').tagName).toBe('DD');
  });
});

describe('FleetPage row actions and bulk (W29, UI standard §2 and §3)', () => {
  beforeEach(() => {
    roles = ['STAFF'];
    retireDevice.mockReset();
    recordReset.mockReset();
  });
  afterEach(cleanup);

  const fleet = () => [
    device({ id: 'd-1', assetTag: 'TL-0001', status: 'MAINTENANCE', version: 3 }),
    device({ id: 'd-2', assetTag: 'TL-0002', status: 'MAINTENANCE', version: 4 }),
    device({ id: 'd-3', assetTag: 'TL-0003', status: 'RETURNED' }),
    device({ id: 'd-4', assetTag: 'TL-0004', status: 'RENTED' }),
    device({ id: 'd-5', assetTag: 'TL-0005', status: 'RETIRED' }),
  ];

  it('offers only the transitions the state and the role allow', () => {
    devices = fleet();
    renderPage();
    // Staff: intake on MAINTENANCE, reset on RETURNED, nothing on RENTED or RETIRED.
    // Intake and reset are item actions; retire and dispose are status changes (chapter 06 §9.6).
    expect(screen.getByRole('button', { name: 'Record intake check TL-0001' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Record reset TL-0003' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /change status of TL-000/ })).toBeNull();
    // Unavailable item actions keep their slots, disabled (chapter 06 §11.4).
    expect(screen.queryAllByRole('button', { name: /^Record .*TL-0004/ }).filter((button) => button.getAttribute('aria-disabled') !== 'true')).toHaveLength(0);
    cleanup();

    roles = ['ADMIN'];
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Maintenance, change status of TL-0001' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Retire device']);
    fireEvent.keyDown(screen.getByRole('menuitem'), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Retired, change status of TL-0005' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Dispose device']);
    expect(screen.queryByRole('button', { name: /change status of TL-0004/ })).toBeNull();
  });

  it('clears the selection when a status chip changes (leader ruling of 2026-11-03)', () => {
    devices = fleet();
    renderPage();
    fireEvent.click(screen.getByLabelText('Select TL-0003'));
    expect(screen.getByRole('button', { name: 'Record reset for 1 device' })).toBeTruthy();
    fireEvent.click(within(screen.getByRole('group', { name: 'Filter by status' })).getByRole('button', { name: /Returned/ }));
    expect((screen.getByLabelText('Select TL-0003') as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByRole('button', { name: 'Record reset for 1 device' })).toBeNull();
  });

  it('retires one device with a reason and its loaded version', async () => {
    roles = ['ADMIN'];
    devices = fleet();
    retireDevice.mockResolvedValue(device({ status: 'RETIRED' }));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Maintenance, change status of TL-0002' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Retire device' }));
    const dialog = within(screen.getByRole('alertdialog', { name: 'Retire device TL-0002?' }));
    fireEvent.change(dialog.getByLabelText(/Reason/), { target: { value: 'Water damage' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Retire device' }));
    await waitFor(() => expect(retireDevice).toHaveBeenCalledWith('d-2', 'Water damage', 4));
  });

  it('retires the selected MAINTENANCE devices in sequence and summarises each row', async () => {
    roles = ['ADMIN'];
    devices = fleet();
    retireDevice
      .mockResolvedValueOnce(device({ status: 'RETIRED' }))
      .mockRejectedValueOnce(new ApiError(409, 'MAINTENANCE_OPEN', 'Finish the open maintenance record first.'));
    renderPage();
    const table = within(screen.getByRole('table', { name: 'Devices' }));
    fireEvent.click(table.getByLabelText('Select TL-0001'));
    fireEvent.click(table.getByLabelText('Select TL-0002'));
    fireEvent.click(table.getByLabelText('Select TL-0004'));
    // The RENTED unit is selected but not retirable: the bar counts the two that are.
    fireEvent.click(screen.getByRole('button', { name: 'Retire 2 devices' }));
    const confirm = within(screen.getByRole('alertdialog', { name: 'Retire 2 devices?' }));
    fireEvent.change(confirm.getByLabelText(/Reason/), { target: { value: 'End of life' } });
    fireEvent.click(confirm.getByRole('button', { name: 'Retire 2 devices' }));
    const summary = await screen.findByRole('dialog', { name: '1 of 2 done' });
    expect(within(summary).getByText('TL-0002').closest('li')?.textContent).toContain('Finish the open maintenance record first.');
    expect(retireDevice.mock.calls).toEqual([
      ['d-1', 'End of life', 3],
      ['d-2', 'End of life', 4],
    ]);
  });

  it('confirms the bulk reset steps before resetting the RETURNED devices', async () => {
    devices = fleet();
    recordReset.mockResolvedValue(device({ status: 'RETURNED' }));
    renderPage();
    fireEvent.click(within(screen.getByRole('table', { name: 'Devices' })).getByLabelText('Select TL-0003'));
    fireEvent.click(screen.getByRole('button', { name: 'Record reset for 1 device' }));
    const confirm = within(screen.getByRole('dialog', { name: 'Record reset for 1 device?' }));
    for (const step of ['Key removed', 'Node database cleared', 'Owner cleared']) fireEvent.click(confirm.getByLabelText(step));
    fireEvent.click(confirm.getByRole('button', { name: 'Record reset for 1 device' }));
    await waitFor(() => expect(recordReset).toHaveBeenCalledWith('d-3'));
  });
});

describe('FleetPage Register panel, Read from unit (devices design 8.3, D-080)', () => {
  const openRegister = async () => {
    renderPage();
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Register device' }));
    return within(screen.getByRole('dialog'));
  };
  const reading = (change: Record<string, unknown> = {}) => ({
    ok: true,
    unit: {
      nodeNum: 2763113172,
      nodeId: '!a4b1c2d4',
      pioEnv: 'treklink-v3-tbeam',
      firmwareVersion: '2.7.19.a4aa98d',
      longName: 'Meshtastic c2d4',
      shortName: 'c2d4',
      ...change,
    },
  });

  it('fills the node number and the variant, keeps the baseline and shows the reported firmware', async () => {
    docking.readUnit.mockResolvedValue(reading());
    const dialog = await openRegister();
    fireEvent.click(dialog.getByRole('button', { name: 'Read from unit' }));
    await waitFor(() =>
      expect((dialog.getByLabelText(/Node number/) as HTMLInputElement).value).toBe('2763113172'),
    );
    expect((dialog.getByLabelText(/Hardware variant/) as HTMLSelectElement).value).toBe('v-3');
    expect((dialog.getByLabelText(/Firmware version/) as HTMLInputElement).value).toBe(
      '2.7.19-treklink.3',
    );
    expect(dialog.getByText('The unit reports 2.7.19.a4aa98d.')).toBeTruthy();
    expect(dialog.queryByRole('status')).toBeNull();
  });

  it('warns when the reported build differs from the baseline', async () => {
    docking.readUnit.mockResolvedValue(reading({ firmwareVersion: '2.7.26.a4aa98d' }));
    const dialog = await openRegister();
    fireEvent.click(dialog.getByRole('button', { name: 'Read from unit' }));
    expect((await dialog.findByRole('status')).textContent).toBe('The unit reports 2.7.26.a4aa98d.');
  });

  it('keeps the fields and says what to check when the unit does not answer', async () => {
    docking.readUnit.mockResolvedValue({ ok: false, failure: 'dock', reason: 'busy' });
    const dialog = await openRegister();
    fireEvent.click(dialog.getByRole('button', { name: 'Read from unit' }));
    expect(
      await dialog.findByText(
        'The unit did not answer. Check the cable, close other Meshtastic apps and try again.',
      ),
    ).toBeTruthy();
    expect((dialog.getByLabelText(/Node number/) as HTMLInputElement).value).toBe('');
  });

  it('disables Read from unit without Web Serial and leaves typing open', async () => {
    docking.supported = false;
    const dialog = await openRegister();
    expect((dialog.getByRole('button', { name: 'Read from unit' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      dialog.getByText(
        'Reading from a unit needs Chrome or Edge on a desktop. You can type the node number.',
      ),
    ).toBeTruthy();
  });
});
