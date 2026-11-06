// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSession } from '../entities/session/model';
import { ConnectorPanelBody } from '../features/device-connector';
import { connectorRegistry, resetConnectorRegistry } from '../features/device-connector/model/ConnectorRegistry';
import type { DockTimings } from '../shared/lib/meshtastic-dock';
import { FakePort, FakeSerial, FakeUnit, unitState } from '../shared/lib/meshtastic-dock.fake';
import { FleetPage } from './FleetPage';

// The leader's UAT of 2026-11-06 (devices design section 12.14, REQ-EVT-49, AC-48): Treklink a264 (!0aa3a264), just
// flashed with the release image, is registered through the green Register device button, not from the connector.
// The connected units panel shows it In intake without a reload, because the page refreshes the connector.

const A264 = 0x0aa3a264;
const TIMINGS: DockTimings = { handshakeMs: 600, writeMs: 700, restartDelayMs: 40, restartDeadlineMs: 400, retryMs: 20 };
const VARIANT = {
  id: 'v-2',
  code: 'treklink-v2',
  name: 'TrekLink v2',
  hasGps: true,
  hasMotionSensor: false,
  mqttCapable: true,
  firmwareBaseline: '2.7.26-treklink.1',
  remainingValueSchedule: [],
  serviceIntervalDays: 180,
  serviceChecklist: [],
  isActive: true,
};

const registered = vi.hoisted(() => ({ done: false }));
const recognizeUnits = vi.hoisted(() => vi.fn());
const registerDevice = vi.hoisted(() => vi.fn());
vi.mock('../entities/device/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../entities/device/api')>()),
  recognizeUnits,
  registerDevice,
  useVariants: () => ({ data: [VARIANT] }),
  useDevices: () => ({
    data: { items: [], pageNumber: 1, pageSize: 20, totalCount: 0, totalPages: 0 },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useDeviceStatusCounts: () => ({}),
}));
vi.mock('../app/providers/useAuth', () => ({ useAuth: () => ({ user: { roles: ['STAFF'] } }) }));
vi.mock('../entities/firmware/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../entities/firmware/api')>()),
  useFirmwareReleases: () => ({ data: [], error: null, isLoading: false }),
}));

const a264 = {
  id: 'd-a264',
  assetTag: 'Treklink a264',
  nodeNum: A264,
  nodeId: '!0aa3a264',
  hardwareVariant: { id: 'v-2', code: 'treklink-v2', name: 'TrekLink v2' },
  firmwareVersion: '2.7.26-treklink.1',
  firmwareBaseline: '2.7.26-treklink.1',
  status: 'IN_INTAKE',
  keyVersion: null,
  keyOrganization: null,
  batteryPct: null,
  lastSeenAt: null,
  serviceDueAt: null,
  openMaintenance: null,
};

beforeEach(() => {
  resetConnectorRegistry();
  registered.done = false;
  recognizeUnits.mockImplementation((nodeNums: number[]) =>
    Promise.resolve(
      nodeNums.map((nodeNum) => ({
        nodeNum,
        nodeId: '!0aa3a264',
        device: registered.done && nodeNum === A264 ? a264 : null,
        contract: null,
        docked: null,
      })),
    ),
  );
  registerDevice.mockImplementation(() => {
    registered.done = true;
    return Promise.resolve({ ...a264, acquiredAt: '2026-11-06T00:00:00Z', statusChangedAt: '2026-11-06T16:00:00Z', version: 0 });
  });
  const serial = new FakeSerial();
  const unit = new FakeUnit(
    unitState({ nodeNum: A264, pioEnv: 'treklink-v2', firmwareVersion: '2.7.26.9f1c0de', longName: 'TrekLink a264', shortName: 'a264' }),
    {},
    serial,
  );
  serial.ports.push(new FakePort(unit, serial));
  Object.defineProperty(window.navigator, 'serial', { value: serial, configurable: true });
  act(() =>
    useSession.getState().signIn(
      { accessToken: 'a', accessTokenExpiresIn: 1, refreshToken: 'r', refreshTokenExpiresIn: 1 },
      { id: 's', email: 'staff@example.test', fullName: 'Staff', accountType: 'TREKLINK', roles: ['STAFF'], organization: null },
    ),
  );
});

afterEach(() => {
  cleanup();
  resetConnectorRegistry();
  Reflect.deleteProperty(window.navigator, 'serial');
  act(() => useSession.getState().signOut());
});

describe('Register device refreshes the connected units (AC-48)', () => {
  it('shows Treklink a264 In intake in the panel after the Register device button, with no reload', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/t/fleet']}>
          <ConnectorPanelBody headingId="panel" />
          <Routes>
            <Route path="/t/fleet" element={<FleetPage />} />
            <Route path="/t/devices/:id" element={<p>Device page</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await act(async () => {
      await connectorRegistry(recognizeUnits, TIMINGS).start();
    });
    const panel = within(screen.getByRole('region', { name: 'Connected units' }));
    await waitFor(() => expect(panel.getByText('Not registered')).toBeTruthy());

    fireEvent.click(screen.getAllByRole('button', { name: 'Register device' })[0]);
    const dialog = within(screen.getByRole('dialog', { name: 'Register device' }));
    fireEvent.change(dialog.getByLabelText(/Asset tag/), { target: { value: 'Treklink a264' } });
    fireEvent.change(dialog.getByLabelText(/Node number/), { target: { value: String(A264) } });
    fireEvent.change(dialog.getByLabelText(/Hardware variant/), { target: { value: 'v-2' } });
    fireEvent.change(dialog.getByLabelText(/Acquired on/), { target: { value: '2026-11-06' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Register device' }));

    await screen.findByText('Device page');
    await waitFor(() => expect(panel.getByText('In intake')).toBeTruthy());
    expect(panel.getByText('Treklink a264')).toBeTruthy();
    expect(screen.getByText(/^Refreshed/)).toBeTruthy();
  });
});
