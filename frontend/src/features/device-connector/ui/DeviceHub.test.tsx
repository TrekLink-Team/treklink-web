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
const startHubAction = vi.hoisted(() => vi.fn());
const finishHubAction = vi.hoisted(() => vi.fn());
const history = vi.hoisted(() => ({ items: [] as unknown[] }));
vi.mock('../../../entities/device/api', () => ({
  recognizeUnits,
  fetchDevice,
  startHubAction,
  finishHubAction,
  useDeviceHistoryFeed: (id: string | null) => ({
    data: id ? { pages: [{ items: history.items, pageNumber: 1, totalPages: 1 }] } : undefined,
    isLoading: false,
    error: null,
    hasNextPage: false,
  }),
  deviceKeys: { device: (id: string) => ['device', id] },
}));
// The firmware releases of api-design 28 (task 8.3): one release carries treklink-v3 unless a test empties it.
const firmware = vi.hoisted(() => ({
  releases: [{ version: '2.7.26-treklink.2', publishedAt: '2026-10-20T03:15:00Z', isBaseline: true, variants: [{ variantCode: 'treklink-v3', chip: 'esp32', app: { offset: 65536, sizeBytes: 8 }, factory: { offset: 0, sizeBytes: 8 } }] }] as unknown[],
}));
vi.mock('../../../entities/firmware/api', async (original) => ({
  ...(await original<typeof import('../../../entities/firmware/api')>()),
  useFirmwareReleases: () => ({ data: firmware.releases, error: null, isLoading: false }),
}));
vi.mock('../../../entities/contract/api', () => ({ issueChannelKey: vi.fn(), exchangeDevice: vi.fn() }));

// The device hub page of screen 4.7 (devices design sections 12.13 and 12.14) over fake units on fake Web Serial
// ports: the not-connected state, the header and field groups, the history, the grouped actions that no status
// disables, the typed confirmation of a rented unit, Reboot, Restore TrekLink defaults, the factory reset and the
// refresh (AC-41 to AC-46, AC-48, AC-51).

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
  startHubAction.mockResolvedValue({ id: 'ha-1', outcome: 'STARTED' });
  finishHubAction.mockResolvedValue({ id: 'ha-1', outcome: 'SUCCEEDED' });
  history.items = [];
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
    useConnectorStore.setState({ open: false, viewing: null, focus: null, context: null, hubUnit: null, flashPanel: null, hubIntent: null });
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

  it('shows the header, the field groups, the history and the grouped actions (AC-41, AC-51)', async () => {
    history.items = [
      { at: '2026-11-06T16:42:00.000Z', kind: 'HUB', summary: 'Firmware update 2.7.26-treklink.2 in the device hub, succeeded', actor: 'Tran Thi B', refType: 'HUB_ACTION', refId: 'ha-1' },
      { at: '2026-11-05T03:00:00.000Z', kind: 'STATE', summary: 'From Rented to Returned', actor: 'Tran Thi B', refType: null, refId: null },
    ];
    // Task 8.3 registers the flash panel in the shell.
    useConnectorStore.setState({ flashPanel: () => null });
    install([A]);
    await renderHub();
    await screen.findByRole('heading', { name: 'TL-0042' });
    expect(screen.getAllByText('Returned, to inspect').length).toBeGreaterThan(0);
    // The unit reports 2.7.26.a4aa98d and the newest release is 2.7.26-treklink.2.
    expect(screen.getByText('Update available')).toBeTruthy();
    const group = (name: string) => screen.getByRole('region', { name });
    const value = (name: string, label: string) => within(group(name)).getByText(label).nextElementSibling?.textContent;
    await waitFor(() => expect(value('Custody and contract', 'Last reset')).toBe('None recorded'));
    expect(value('Identity', 'Node')).toBe(`${A} (!a4b1c2d4)`);
    expect(value('Identity', 'Hardware model')).toBe('TBEAM');
    expect(value('Identity', 'Owner')).toBe('TL-0042 (0042)');
    expect(value('Radio and region', 'Region')).toBe('MY_433');
    expect(value('Radio and region', 'Modem preset')).toBe('LONG_FAST');
    expect(value('Radio and region', 'Primary channel')).toBe('ORG-SAPA');
    expect(value('Power', 'Battery')).toBe('87 %');
    expect(value('Power', 'Voltage')).toBe('4.05 V');
    expect(screen.getByRole('meter', { name: 'Battery 87 %' })).toBeTruthy();
    expect(value('Custody and contract', 'Key version')).toBe('v2, ORG-SAPA');
    expect(value('Custody and contract', 'Contract')).toBe('None');
    expect(value('Firmware', 'Latest release')).toBe('2.7.26-treklink.2');
    // The history, newest first, in its own named scroll region.
    const list = screen.getByRole('region', { name: 'Device history' });
    expect(list.getAttribute('tabindex')).toBe('0');
    expect(within(list).getAllByRole('listitem')[0].textContent).toContain('Firmware update 2.7.26-treklink.2');
    // Three groups; no action disabled for a returned unit.
    const actions = screen.getByRole('region', { name: 'Actions' });
    expect(within(actions).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([
      'Configure',
      'Firmware',
      'Danger zone',
    ]);
    for (const name of ['Configure uplink', 'Restore TrekLink defaults', 'Reboot', 'Update firmware', 'Factory reset']) {
      expect((actionButton(name) as HTMLButtonElement).disabled).toBe(false);
    }
    expect((actionButton('Re-provision') as HTMLButtonElement).disabled).toBe(true);
    expect(within(actions).getByText('No contract to provision for. Reserve TL-0042 on a contract first.')).toBeTruthy();
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

  it('reboots the unit and records the reboot (AC-42)', async () => {
    install([A]);
    await renderHub();
    await screen.findByRole('heading', { name: 'TL-0042' });
    await waitFor(() => expect((actionButton('Reboot') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(actionButton('Reboot'));
    await waitFor(() => expect(useToast.getState().message).toBe('TL-0042 restarted.'), { timeout: 3000 });
    expect(units[0].writes.map((write) => write.variant)).toEqual(['reboot_seconds']);
    expect(startHubAction).toHaveBeenCalledWith('d-42', { action: 'REBOOT', nodeNum: A });
    // The Reboot button is disabled while the unit is read again, so focus goes to the Actions heading.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Actions' })));
  });

  it('confirms, wipes the returned unit and records the action with the docked node number (AC-43)', async () => {
    install([A]);
    await renderHub();
    await screen.findByRole('heading', { name: 'TL-0042' });
    await waitFor(() => expect((actionButton('Factory reset') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(actionButton('Factory reset'));
    const dialog = await screen.findByRole('alertdialog', { name: 'Factory reset TL-0042?' });
    expect(within(dialog).getByText('the channel key of ORG-SAPA')).toBeTruthy();
    expect(within(dialog).getByText(/region MY_433 is written back/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Factory reset' }));
    await waitFor(() => expect(useToast.getState().message).toBe('TL-0042 is reset.'), { timeout: 5000 });
    expect(startHubAction).toHaveBeenCalledWith('d-42', { action: 'FACTORY_RESET', nodeNum: A });
    expect(finishHubAction).toHaveBeenCalledWith('d-42', 'ha-1', { outcome: 'SUCCEEDED' });
    expect(units[0].state).toMatchObject({ longName: 'TL-0042', shortName: '0042', region: 16, channelName: '' });
    expect(Array.from(units[0].state.psk)).toEqual([1]);
  });

  it('asks for the asset tag typed before any action on a rented unit, and names the contract (AC-45)', async () => {
    recognizeUnits.mockImplementation((nodeNums: number[]) =>
      Promise.resolve(
        nodeNums.map((nodeNum) => ({
          ...registered(nodeNum),
          device: { ...registered(nodeNum).device, status: 'RENTED' },
          contract: { id: 'c-40', code: 'RC-2026-0040', status: 'ACTIVE', organization: { id: 'o-1', code: 'ORG-SAPA' }, provisionedKeyVersion: 2 },
        })),
      ),
    );
    install([A]);
    await renderHub();
    await screen.findByRole('heading', { name: 'TL-0042' });
    await waitFor(() => expect((actionButton('Restore TrekLink defaults') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(actionButton('Restore TrekLink defaults'));
    const dialog = await screen.findByRole('alertdialog', { name: 'Restore TrekLink defaults on TL-0042?' });
    expect(within(dialog).getByText(/TL-0042 is rented on RC-2026-0040 for ORG-SAPA\./)).toBeTruthy();
    const confirm = within(dialog).getByRole('button', { name: 'Restore defaults' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Type TL-0042 to confirm'), { target: { value: 'tl-0042' } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(useToast.getState().message).toBe('TL-0042 is back on the TrekLink defaults.'), {
      timeout: 5000,
    });
    expect(startHubAction).toHaveBeenCalledWith('d-42', { action: 'RESTORE_DEFAULTS', nodeNum: A, confirmAssetTag: 'tl-0042' });
    expect(units[0].writes.map((write) => write.variant)).toEqual([
      'begin_edit_settings',
      'set_owner',
      'set_channel',
      'set_config',
      'set_module_config',
      'commit_edit_settings',
    ]);
    expect(Array.from(units[0].state.psk)).toEqual([1]);
  });

  it('runs the Reboot a card asked for once the unit is read (design section 12.14)', async () => {
    install([A]);
    act(() => useConnectorStore.setState({ hubIntent: { connectionId: 1, action: 'reboot' } }));
    await renderHub();
    await waitFor(() => expect(useToast.getState().message).toBe('TL-0042 restarted.'), { timeout: 4000 });
    expect(units[0].writes.map((write) => write.variant)).toEqual(['reboot_seconds']);
    expect(useConnectorStore.getState().hubIntent).toBeNull();
  });

  it('asks the server again for every unit on Refresh and shows the time (AC-48)', async () => {
    install([A]);
    await renderHub();
    await screen.findByRole('heading', { name: 'TL-0042' });
    const calls = recognizeUnits.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh the unit and its record' }));
    await waitFor(() => expect(recognizeUnits.mock.calls.length).toBeGreaterThan(calls));
    expect(screen.getByText(/^Refreshed/)).toBeTruthy();
  });
});
