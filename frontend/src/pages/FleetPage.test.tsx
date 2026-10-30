// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../shared/api/apiClient';
import { FleetPage } from './FleetPage';

const registerDevice = vi.fn();

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

vi.mock('../entities/device/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../entities/device/api')>()),
  useVariants: () => ({ data: [VARIANT] }),
  useDevices: () => ({ data: page([device()]), isLoading: false, error: null, refetch: vi.fn() }),
  registerDevice: (...args: unknown[]) => registerDevice(...args),
}));

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <FleetPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => registerDevice.mockReset());
afterEach(cleanup);

describe('FleetPage (/t/fleet, screen 4.2)', () => {
  it('lists the fleet with its asset tag, variant, status and battery', async () => {
    renderPage();
    expect(await screen.findByText('TL-0042')).toBeTruthy();
    const row = screen.getByText('TL-0042').closest('tr') as HTMLElement;
    expect(within(row).getByText('treklink-v3')).toBeTruthy();
    expect(within(row).getByText('Available')).toBeTruthy();
    expect(within(row).getByText('96%')).toBeTruthy();
  });

  it('opens the register dialog and submits the form', async () => {
    registerDevice.mockResolvedValue(device({ id: 'd-new', assetTag: 'TL-0099' }));
    renderPage();
    await screen.findByText('TL-0042');
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
  });

  it('shows the conflict message under the form on CONFLICT_UNIQUE', async () => {
    registerDevice.mockRejectedValueOnce(
      new ApiError(409, 'CONFLICT_UNIQUE', 'TL-0099 is already registered.'),
    );
    renderPage();
    await screen.findByText('TL-0042');
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
    await screen.findByText('TL-0042');
    fireEvent.click(screen.getByRole('button', { name: 'Register device' }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.click(dialog.getByRole('button', { name: 'Register device' }));
    expect(await screen.findAllByText('Please fill in this field.')).not.toHaveLength(0);
    expect(registerDevice).not.toHaveBeenCalled();
  });
});
