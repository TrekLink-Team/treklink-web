// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSession, type SessionUser } from '../../../entities/session/model';
import type { DockTimings } from '../../../shared/lib/meshtastic-dock';
import { FakePort, FakeSerial, FakeUnit, unitState } from '../../../shared/lib/meshtastic-dock.fake';
import { useToast } from '../../../shared/ui/toastStore';
import { connectorRegistry, resetConnectorRegistry } from '../model/ConnectorRegistry';
import { useConnectorStore } from '../model/connectorStore';
import { DeviceHub } from './DeviceHub';

const recognizeUnits = vi.hoisted(() => vi.fn());
const fetchDevice = vi.hoisted(() => vi.fn());
const recordReset = vi.hoisted(() => vi.fn());
vi.mock('../../../entities/device/api', () => ({
  recognizeUnits,
  fetchDevice,
  recordReset,
  deviceKeys: { device: (id: string) => ['device', id] },
}));
vi.mock('../../../entities/contract/api', () => ({ issueChannelKey: vi.fn(), exchangeDevice: vi.fn() }));

// The device hub page of screen 4.7 (devices design section 12.13) over fake units on fake Web Serial
// ports: the not-connected state, the Device info read from the unit and the server, the six actions
// with their reasons, the switcher, Reboot and the factory reset (AC-41 to AC-44).

const STAFF: SessionUser = {
  id: 's',
  email: 'staff@example.test',
  fullName: 'Tran Thi B',
  accountType: 'TREKLINK',
  roles: ['STAFF'],
  organization: null,
};
const TIMINGS: DockTimings = { handshakeMs: 600, writeMs: 700, restartDelayMs: 40, restartDeadlineMs: 400, retryMs: 20 };
const A = 0xa4b1c2d4;
const B = 0xa4b1c2e5;
const KEY = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

const registered = (nodeNum: number) => ({
  nodeNum,
  nodeId: `!${nodeNum.toString(16)}`,
  device: {
    id: 'd-42',
    assetTag: 'TL-0042',
    nodeNum,
    nodeId: `!${nodeNum.toString(16)}`,
    hardwareVariant: { id: 'v', code: 'treklink-v3', name: 'TrekLink v3 (GPS, SOS button)' },
    firmwareVersion: '2.7.19-treklink.3',
    firmwareBaseline: '2.7.19-treklink.3',
    status: 'RETURNED',
    keyVersion: 2,
    keyOrganization: { id: 'o-1', code: 'ORG-SAPA', legalName: 'Sapa Trek' },
    batteryPct: 61,
    lastSeenAt: '2026-11-03T03:00:00.000Z',
    serviceDueAt: null,
    openMaintenance: null,
  },
  contract: null,
  docked: null,
});

let units: FakeUnit[] = [];
const install = (nodeNums: number[]) => {
  const serial = new FakeSerial();
  units = nodeNums.map((nodeNum) => {
    const unit = new FakeUnit(
      unitState({ nodeNum, psk: KEY, longName: 'TL-0042', shortName: '0042', channelName: 'ORG-SAPA' }),
      {},
      serial,
    );
    serial.ports.push(new FakePort(unit, serial));
    return unit;
  });
  Object.defineProperty(window.navigator, 'serial', { value: serial, configurable: true });
};

const renderHub = async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DeviceHub timings={TIMINGS} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await act(async () => {
    await connectorRegistry(recognizeUnits, TIMINGS).start();
  });
};

const actionButton = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) });

beforeEach(() => {
  resetConnectorRegistry();
  recognizeUnits.mockImplementation((nodeNums: number[]) =>
    Promise.resolve(
      nodeNums.map((nodeNum) =>
        nodeNum === A
          ? registered(nodeNum)
          : { nodeNum, nodeId: `!${nodeNum.toString(16)}`, device: null, contract: null, docked: null },
      ),
    ),
  );
  fetchDevice.mockResolvedValue({ id: 'd-42', lastReset: null, nextStep: { action: 'RESET', contractId: 'c-40' } });
  recordReset.mockResolvedValue({ id: 'd-42', keyVersion: null });
  act(() =>
    useSession
      .getState()
      .signIn({ accessToken: 'a', accessTokenExpiresIn: 1, refreshToken: 'r', refreshTokenExpiresIn: 1 }, STAFF),
  );
});

afterEach(() => {
  cleanup();
  resetConnectorRegistry();
  vi.clearAllMocks();
  Reflect.deleteProperty(window.navigator, 'serial');
  act(() => {
    useSession.getState().signOut();
    useConnectorStore.setState({ open: false, viewing: null, focus: null, context: null, hubUnit: null, flashPanel: null });
    useToast.getState().dismiss();
  });
});

describe('DeviceHub (screen 4.7)', () => {
  it('says no unit is connected and offers Connect a unit', async () => {
    install([]);
    await renderHub();
    expect(screen.getByText('No unit connected. Plug a unit in with its USB cable, then choose Connect a unit.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connect a unit' })).toBeTruthy();
  });

  it('shows the Chromium banner without Web Serial (REQ-ERR-11)', async () => {
    Reflect.deleteProperty(window.navigator, 'serial');
    await renderHub();
    expect(screen.getByText('Docking needs Chrome or Edge on a desktop. Open TrekLink there to connect units.')).toBeTruthy();
  });

  it('shows the unit, its Device info from the unit and the server, and the six actions (AC-41)', async () => {
    install([A]);
    await renderHub();
    await screen.findByRole('heading', { name: 'TL-0042' });
    const info = screen.getByRole('region', { name: 'Device info' });
    await waitFor(() => expect(within(info).getByText('None recorded')).toBeTruthy());
    const value = (label: string) => within(info).getByText(label).nextElementSibling?.textContent;
    expect(value('Node number')).toBe(`${A} (!a4b1c2d4)`);
    expect(value('Hardware model')).toBe('TBEAM');
    expect(value('Battery')).toBe('87 %, 4.05 V (from the unit)');
    expect(value('Region')).toBe('MY_433, LONG_FAST');
    expect(value('Primary channel')).toBe('ORG-SAPA');
    expect(value('Owner')).toBe('TL-0042 (0042)');
    expect(value('Key version')).toBe('v2, ORG-SAPA');
    expect(value('Contract')).toBe('None');
    // The render slot names the variant when the file is missing (REQ-ERR-31): jsdom loads no image.
    expect(screen.getByRole('img', { name: 'TrekLink v3 (GPS, SOS button), front view' })).toBeTruthy();
    const actions = screen.getByRole('region', { name: 'Actions' });
    expect(within(actions).getAllByRole('listitem')).toHaveLength(6);
    expect((actionButton('Factory reset') as HTMLButtonElement).disabled).toBe(false);
    expect((actionButton('Reboot') as HTMLButtonElement).disabled).toBe(false);
    expect((actionButton('Provision') as HTMLButtonElement).disabled).toBe(true);
    expect(within(actions).getByText('Provision from the counter of its contract.')).toBeTruthy();
    expect(within(actions).getByText('Firmware releases are not published yet')).toBeTruthy();
  });

  it('switches between connected units without putting a node number in the address bar', async () => {
    install([A, B]);
    await renderHub();
    const group = await screen.findByRole('group', { name: 'Connected units' });
    await waitFor(() => expect(within(group).getAllByRole('button')).toHaveLength(2));
    const [first, second] = within(group).getAllByRole('button');
    expect(first.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(second);
    await screen.findByRole('heading', { name: 'Unknown unit' });
    expect(second.getAttribute('aria-pressed')).toBe('true');
    expect((await screen.findAllByText('Register this unit first.')).length).toBeGreaterThan(0);
    expect(window.location.href).not.toContain(B.toString(16));
  });

  it('reboots the unit and calls no endpoint (AC-42)', async () => {
    install([A]);
    await renderHub();
    await screen.findByRole('heading', { name: 'TL-0042' });
    await waitFor(() => expect((actionButton('Reboot') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(actionButton('Reboot'));
    await waitFor(() => expect(useToast.getState().message).toBe('TL-0042 restarted.'), { timeout: 3000 });
    expect(units[0].writes.map((write) => write.variant)).toEqual(['reboot_seconds']);
    // The Reboot button is disabled while the unit is read again, so focus goes to the Actions heading.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Actions' })));
    expect(recordReset).not.toHaveBeenCalled();
  });

  it('confirms, wipes the returned unit and records the reset with the docked node number (AC-43)', async () => {
    install([A]);
    await renderHub();
    await screen.findByRole('heading', { name: 'TL-0042' });
    await waitFor(() => expect((actionButton('Factory reset') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(actionButton('Factory reset'));
    const dialog = await screen.findByRole('alertdialog', { name: 'Factory reset TL-0042?' });
    expect(within(dialog).getByText('the channel key of ORG-SAPA')).toBeTruthy();
    expect(within(dialog).getByText(/region MY_433 is written back/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Factory reset' }));
    await waitFor(() => expect(useToast.getState().message).toBe('TL-0042 is reset. Inspect it at the counter next.'), {
      timeout: 5000,
    });
    expect(recordReset).toHaveBeenCalledWith('d-42', A);
    // The Factory reset button is disabled now (already reset), so focus goes to the Actions heading.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Actions' })));
    expect(units[0].state).toMatchObject({ longName: 'TL-0042', shortName: '0042', region: 16, channelName: '' });
    expect(Array.from(units[0].state.psk)).toEqual([1]);
  });

  it('keeps factory reset unavailable with its reason for a unit already reset (AC-44)', async () => {
    fetchDevice.mockResolvedValue({ id: 'd-42', lastReset: { createdAt: '2026-11-04T02:00:00.000Z' }, nextStep: { action: 'INSPECT', contractId: 'c-40' } });
    install([A]);
    await renderHub();
    await screen.findByText('TL-0042 is already reset for this return.');
    expect((actionButton('Factory reset') as HTMLButtonElement).disabled).toBe(true);
  });
});
