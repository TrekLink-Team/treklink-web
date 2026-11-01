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
  hardwareVariant: { id: 'v-3', code: 'treklink-v3' },
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
const seenFilters: { status?: string[] }[] = [];

vi.mock('../entities/device/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../entities/device/api')>()),
  useVariants: () => ({ data: [VARIANT] }),
  useDevices: (filters: { status?: string[] }) => {
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

  it('shows the first-run empty state, and MSG01 once a filter is set', async () => {
    devices = [];
    renderPage();
    expect(await screen.findByText('No devices registered yet.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Available/ }));
    expect(await screen.findByText('No results match your filters.')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]);
    expect(await screen.findByText('No devices registered yet.')).toBeTruthy();
  });

  it('shows a card per device for the phone layout', async () => {
    renderPage();
    const cards = within(await screen.findByRole('list', { name: 'Devices' }));
    expect(cards.getByText('TL-0042')).toBeTruthy();
    expect(cards.getByText(/Battery 96%/)).toBeTruthy();
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
    expect(screen.getByRole('button', { name: /Record intake check\s+TL-0001/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Retire device\s+TL-0001/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Record reset\s+TL-0003/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /TL-0004$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Dispose device\s+TL-0005/ })).toBeNull();
    cleanup();

    roles = ['ADMIN'];
    renderPage();
    expect(screen.getByRole('button', { name: /Retire device\s+TL-0001/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Dispose device\s+TL-0005/ })).toBeTruthy();
  });

  it('retires one device with a reason and its loaded version', async () => {
    roles = ['ADMIN'];
    devices = fleet();
    retireDevice.mockResolvedValue(device({ status: 'RETIRED' }));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Retire device\s+TL-0002/ }));
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
