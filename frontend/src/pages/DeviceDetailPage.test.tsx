// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../shared/api/apiClient';
import { DeviceDetailPage } from './DeviceDetailPage';

const recordIntakeCheck = vi.fn();
const recordReset = vi.fn();
const retireDevice = vi.fn();
const disposeDevice = vi.fn();
const editFirmware = vi.fn();

const VARIANT = {
  id: 'v-3',
  code: 'treklink-v3',
  name: 'TrekLink v3',
  hasGps: true,
  hasMotionSensor: true,
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
let currentRoles = ['STAFF'];

vi.mock('../app/providers/useAuth', () => ({
  useAuth: () => ({ user: { id: 'staff-1', roles: currentRoles } }),
}));

vi.mock('../entities/device/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../entities/device/api')>()),
  useDevice: () => ({ data: currentDevice, isLoading: false, error: null, refetch: vi.fn() }),
  useDeviceHistory: () => ({ data: { items: [], pageNumber: 1, pageSize: 20, totalCount: 0, totalPages: 0 } }),
  useVariants: () => ({ data: [VARIANT] }),
  recordIntakeCheck: (...args: unknown[]) => recordIntakeCheck(...args),
  recordReset: (...args: unknown[]) => recordReset(...args),
  retireDevice: (...args: unknown[]) => retireDevice(...args),
  disposeDevice: (...args: unknown[]) => disposeDevice(...args),
  editFirmware: (...args: unknown[]) => editFirmware(...args),
}));

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/t/devices/d-1']}>
        <Routes>
          <Route path="/t/devices/:id" element={<DeviceDetailPage />} />
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
});
afterEach(cleanup);

describe('DeviceDetailPage (/t/devices/:id, screen 4.2)', () => {
  it('shows the header facts', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'TL-0042' })).toBeTruthy();
    expect(screen.getByText('!a4b1c2d3 (2763113171)')).toBeTruthy();
    expect(screen.getByText('treklink-v3')).toBeTruthy();
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
    const dialog = within(screen.getByRole('dialog'));
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
    const dialog = within(screen.getByRole('dialog'));
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
});
