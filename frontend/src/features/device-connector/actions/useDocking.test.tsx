// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../shared/api/apiClient';
import type { DockTimings } from '../../../shared/lib/meshtastic-dock';
import {
  FakePort,
  fakeDock,
  type UnitBehaviour,
  type UnitState,
} from '../../../shared/lib/meshtastic-dock.fake';
import { DockingService, ownerFor } from './DockingService';
import { NO_RESPONSE_MESSAGE, handoverDockMessage, uplinkDockMessage } from './messages';
import { useDocking } from './useDocking';
import { connectorRegistry, resetConnectorRegistry } from '../model/ConnectorRegistry';

const issueChannelKey = vi.hoisted(() => vi.fn());
vi.mock('../../../entities/contract/api', () => ({ issueChannelKey, exchangeDevice: vi.fn() }));
const recognizeUnits = vi.hoisted(() => vi.fn());
const startHubAction = vi.hoisted(() => vi.fn());
const finishHubAction = vi.hoisted(() => vi.fn());
vi.mock('../../../entities/device/api', () => ({ recognizeUnits, startHubAction, finishHubAction }));

// DockingService and useDocking against the wire-level fake unit (devices design section 8.7). No
// hardware is involved.

const TIMINGS: DockTimings = {
  handshakeMs: 600,
  writeMs: 700,
  restartDelayMs: 40,
  restartDeadlineMs: 300,
  retryMs: 20,
};
const KEY_HEX = '3f9c0e1a2b4d5e6f7081920a1b2c3d4e5f60718293a4b5c6d7e8f9001a2b3c4d';
const KEY = Uint8Array.from(KEY_HEX.match(/../g) ?? [], (pair) => parseInt(pair, 16));
const NODE = 0xa4b1c2d4;
const TARGET = { contractId: 'c-1', deviceId: 'd-42', assetTag: 'TL-0042', nodeNum: NODE };
const UPLINK = {
  wifiSsid: 'Base camp',
  wifiPassword: 'wifi-secret',
  brokerAddress: '192.168.1.20:1883',
  brokerUsername: '',
  brokerPassword: '',
  tls: false,
};

let consoleSpies: ReturnType<typeof vi.spyOn>[] = [];

const dock = (state: Partial<UnitState> = {}, behaviour: UnitBehaviour = {}) => {
  const setup = fakeDock(state, behaviour);
  Object.defineProperty(window.navigator, 'serial', { value: setup.serial, configurable: true });
  return setup;
};

const render = () => renderHook(() => useDocking({ timings: TIMINGS }));

beforeEach(() => {
  resetConnectorRegistry();
  recognizeUnits.mockReset();
  recognizeUnits.mockImplementation((nodeNums: number[]) =>
    Promise.resolve(nodeNums.map((nodeNum) => ({ nodeNum, nodeId: '', device: null, contract: null, docked: null }))),
  );
  issueChannelKey.mockReset();
  issueChannelKey.mockResolvedValue({ keyHex: KEY_HEX, keyVersion: 3 });
  startHubAction.mockReset();
  startHubAction.mockResolvedValue({ id: 'ha-1', outcome: 'STARTED' });
  finishHubAction.mockReset();
  finishHubAction.mockResolvedValue({ id: 'ha-1', outcome: 'SUCCEEDED' });
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation(() => undefined),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window.navigator, 'serial');
  localStorage.clear();
  sessionStorage.clear();
});

describe('useDocking.dockAndProvision', () => {
  it('reads, asks for the key with the docked nodeNum, writes, reads back and wipes the key', async () => {
    const { unit } = dock();
    const provision = vi.spyOn(DockingService.prototype, 'provision');
    const { result } = render();
    let outcome: Awaited<ReturnType<typeof result.current.dockAndProvision>> | undefined;
    await act(async () => {
      outcome = await result.current.dockAndProvision(TARGET);
    });
    expect(outcome).toMatchObject({ ok: true, nodeNum: NODE, keyVersion: 3 });
    expect(issueChannelKey).toHaveBeenCalledWith('c-1', 'd-42', NODE);
    expect(unit.state).toMatchObject({ longName: 'TL-0042', shortName: '0042', psk: KEY });
    // The one key variable is wiped once provision returns (REQ-UBI-05).
    const handed = provision.mock.calls[0][1];
    expect(Array.from(handed).every((byte) => byte === 0)).toBe(true);
    expect(localStorage.length + sessionStorage.length).toBe(0);
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    expect(result.current.state).toEqual({ target: null, stage: null });
  });

  it('writes nothing and asks for no key when the docked unit is another device (REQ-ERR-12)', async () => {
    const { unit, port } = dock({ nodeNum: 0x0004351c });
    const { result } = render();
    let outcome: Awaited<ReturnType<typeof result.current.dockAndProvision>> | undefined;
    await act(async () => {
      outcome = await result.current.dockAndProvision(TARGET);
    });
    expect(outcome).toMatchObject({ ok: false, failure: 'mismatch' });
    expect(handoverDockMessage(outcome as never, 'TL-0042')).toBe(
      'The docked unit is !0004351c, not TL-0042. Nothing was written.',
    );
    expect(issueChannelKey).not.toHaveBeenCalled();
    expect(unit.writes).toEqual([]);
    expect(port.readable).toBeNull();
  });

  it('names the docked node when the server answers NODE_MISMATCH, and writes nothing', async () => {
    const { unit } = dock();
    issueChannelKey.mockRejectedValue(new ApiError(409, 'NODE_MISMATCH', 'The docked unit ...'));
    const { result } = render();
    let outcome: Awaited<ReturnType<typeof result.current.dockAndProvision>> | undefined;
    await act(async () => {
      outcome = await result.current.dockAndProvision(TARGET);
    });
    expect(handoverDockMessage(outcome as never, 'TL-0042')).toBe(
      'The docked unit is !a4b1c2d4, not TL-0042. Nothing was written.',
    );
    expect(unit.writes).toEqual([]);
  });

  it('reports a read-back that differs and returns nothing to record (REQ-ERR-13)', async () => {
    dock({}, { losePskOnCommit: true });
    const { result } = render();
    let outcome: Awaited<ReturnType<typeof result.current.dockAndProvision>> | undefined;
    await act(async () => {
      outcome = await result.current.dockAndProvision(TARGET);
    });
    expect(outcome).toMatchObject({ ok: false, failure: 'read-back' });
    expect(handoverDockMessage(outcome as never, 'TL-0042')).toBe(
      'The read-back differs: channel key. Dock TL-0042 again before handover.',
    );
  });

  it('shows the v2 message when the unit answers nothing over USB (REQ-ERR-14)', async () => {
    dock({}, { silent: true });
    const { result } = render();
    let outcome: Awaited<ReturnType<typeof result.current.dockAndProvision>> | undefined;
    await act(async () => {
      outcome = await result.current.dockAndProvision(TARGET);
    });
    expect(handoverDockMessage(outcome as never, 'TL-0042')).toBe(NO_RESPONSE_MESSAGE);
    expect(issueChannelKey).not.toHaveBeenCalled();
  });

  it('asks Staff to reconnect when the port does not come back, then reads back on the chosen port', async () => {
    const { unit, serial } = dock({}, { restart: 'never-returns', restartAfterMs: 5 });
    const { result } = render();
    let pending: Promise<unknown> | undefined;
    act(() => {
      pending = result.current.dockAndProvision(TARGET);
    });
    await waitFor(() => expect(result.current.state.stage).toBe('reconnect'), { timeout: 4000 });
    serial.chooserAnswer = new FakePort(unit, serial);
    await act(async () => {
      await result.current.reconnect();
      await pending;
    });
    expect(await pending).toMatchObject({ ok: true, nodeNum: NODE, keyVersion: 3 });
  });

  it('records nothing when Staff give up on a unit that did not come back', async () => {
    dock({}, { restart: 'never-returns', restartAfterMs: 5 });
    const { result } = render();
    let pending: Promise<unknown> | undefined;
    act(() => {
      pending = result.current.dockAndProvision(TARGET);
    });
    await waitFor(() => expect(result.current.state.stage).toBe('reconnect'), { timeout: 4000 });
    await act(async () => {
      result.current.giveUp();
      await pending;
    });
    expect(handoverDockMessage((await pending) as never, 'TL-0042')).toBe(
      'The unit did not come back after its restart. Dock TL-0042 again before handover.',
    );
  });
});

describe('useDocking, review of the docking slice', () => {
  it('lets the port go and records nothing when the page is left mid-docking', async () => {
    const { unit, serial } = dock({}, { restart: 'never-returns', restartAfterMs: 5 });
    const { result, unmount } = render();
    let pending: Promise<unknown> | undefined;
    act(() => {
      pending = result.current.dockAndProvision(TARGET);
    });
    await waitFor(() => expect(result.current.state.stage).toBe('reconnect'), { timeout: 4000 });

    unmount();

    await expect(pending).resolves.toMatchObject({ ok: false, failure: 'not-returned' });
    expect(serial.ports.every((port) => port.readable === null)).toBe(true);
    // The write reached the unit before the restart; the caller gets nothing to record.
    expect(unit.writes.length).toBeGreaterThan(0);
    expect(localStorage.length + sessionStorage.length).toBe(0);
  });

  it('writes nothing when the server sends a malformed key', async () => {
    const { unit } = dock();
    issueChannelKey.mockResolvedValue({ keyHex: 'not-hex', keyVersion: 3 });
    const { result } = render();
    let outcome: Awaited<ReturnType<typeof result.current.dockAndProvision>> | undefined;
    await act(async () => {
      outcome = await result.current.dockAndProvision(TARGET);
    });
    expect(outcome).toMatchObject({ ok: false, failure: 'dock', reason: 'The channel key is malformed.' });
    expect(unit.writes).toEqual([]);
  });

  it('says nothing and asks for no key when Staff close the port chooser', async () => {
    const { serial } = dock();
    serial.ports = [];
    serial.chooserAnswer = null;
    const { result } = render();
    let outcome: Awaited<ReturnType<typeof result.current.dockAndProvision>> | undefined;
    await act(async () => {
      outcome = await result.current.dockAndProvision(TARGET);
    });
    expect(serial.requestCount).toBe(1);
    expect(outcome).toMatchObject({ ok: false, failure: 'cancelled' });
    expect(handoverDockMessage(outcome as never, 'TL-0042')).toBeNull();
    expect(issueChannelKey).not.toHaveBeenCalled();
  });
});

describe('useDocking.readUnit and configureUplink', () => {
  it('reads a unit for intake and lets the port go', async () => {
    const { port } = dock();
    const { result } = render();
    let outcome: Awaited<ReturnType<typeof result.current.readUnit>> | undefined;
    await act(async () => {
      outcome = await result.current.readUnit();
    });
    expect(outcome).toMatchObject({ ok: true, unit: { nodeNum: NODE, pioEnv: 'treklink-v3-tbeam' } });
    expect(port.readable).toBeNull();
  });

  it('configures the uplink and reads it back', async () => {
    const { unit } = dock();
    const { result } = render();
    let outcome: Awaited<ReturnType<typeof result.current.configureUplink>> | undefined;
    await act(async () => {
      outcome = await result.current.configureUplink(TARGET, UPLINK);
    });
    expect(outcome).toEqual({ ok: true });
    expect(unit.state.mqtt).toMatchObject({ address: '192.168.1.20:1883', root: 'treklink' });
  });

  it('names the failed uplink check', async () => {
    dock({}, { loseMqttAddressOnCommit: true });
    const { result } = render();
    let outcome: Awaited<ReturnType<typeof result.current.configureUplink>> | undefined;
    await act(async () => {
      outcome = await result.current.configureUplink(TARGET, UPLINK);
    });
    expect(uplinkDockMessage(outcome as never, 'TL-0042')).toBe(
      'TL-0042 is not configured as an uplink: the read-back differs: broker address.',
    );
  });
});

describe('useDocking.configureUplink, a unit that does not come back', () => {
  it('says the unit is not configured when Staff stop waiting', async () => {
    dock({}, { restart: 'never-returns', restartAfterMs: 5 });
    const { result } = render();
    let pending: Promise<unknown> | undefined;
    act(() => {
      pending = result.current.configureUplink(TARGET, UPLINK);
    });
    await waitFor(() => expect(result.current.state.stage).toBe('reconnect'), { timeout: 4000 });
    await act(async () => {
      result.current.giveUp();
      await pending;
    });
    expect(uplinkDockMessage((await pending) as never, 'TL-0042')).toBe(
      'TL-0042 is not configured as an uplink: the unit did not come back after its restart.',
    );
  });
});

describe('ownerFor', () => {
  it('writes the asset tag as the long name and its last four characters as the short name', () => {
    expect(ownerFor('TL-0009')).toEqual({ longName: 'TL-0009', shortName: '0009' });
  });
});

// The device hub page's writes (devices design section 12.13, REQ-EVT-45, REQ-EVT-46, REQ-ERR-33).
describe('useDocking reboot and factory reset', () => {
  // The one connection the registry holds once its unit is read and looked up.
  const readyConnection = async () => {
    const registry = connectorRegistry(recognizeUnits, TIMINGS);
    await waitFor(() => expect(registry.getSnapshot().connections[0]?.state).toBe('ready'));
    return registry.getSnapshot().connections[0].id;
  };
  const RETURNED_UNIT = { contractId: 'c-1', deviceId: 'd-42', assetTag: 'TL-0042', nodeNum: NODE };

  it('reboots an unknown unit, sees the same node again and records nothing', async () => {
    const { unit } = dock();
    const { result } = render();
    const id = await readyConnection();
    let outcome: Awaited<ReturnType<typeof result.current.reboot>> | undefined;
    await act(async () => {
      outcome = await result.current.reboot(id);
    });
    expect(outcome).toEqual({ ok: true });
    expect(unit.writes.map((write) => write.variant)).toEqual(['reboot_seconds']);
    expect(startHubAction).not.toHaveBeenCalled();
    expect(issueChannelKey).not.toHaveBeenCalled();
  });

  it('records the reboot of a registered unit as a hub action with the typed asset tag (design section 12.14)', async () => {
    dock();
    const { result } = render();
    const id = await readyConnection();
    await act(async () => {
      await result.current.reboot(id, { deviceId: 'd-42', confirmAssetTag: 'TL-0042' });
    });
    expect(startHubAction).toHaveBeenCalledWith('d-42', { action: 'REBOOT', nodeNum: NODE, confirmAssetTag: 'TL-0042' });
    expect(finishHubAction).toHaveBeenCalledWith('d-42', 'ha-1', { outcome: 'SUCCEEDED' });
  });

  it('wipes the unit in any status, writes its owner and region back, reads them back and records the action', async () => {
    const { unit } = dock({ psk: KEY, longName: 'TL-0042', shortName: '0042', wifiEnabled: true });
    unit.state.mqtt.enabled = true;
    const { result } = render();
    const id = await readyConnection();
    let outcome: Awaited<ReturnType<typeof result.current.factoryReset>> | undefined;
    await act(async () => {
      outcome = await result.current.factoryReset(id, { ...RETURNED_UNIT, confirmAssetTag: 'TL-0042' });
    });
    expect(outcome).toMatchObject({ ok: true, wiped: true });
    expect(unit.writes.map((write) => write.variant)).toEqual([
      'factory_reset_config',
      'begin_edit_settings',
      'set_owner',
      'set_config',
      'commit_edit_settings',
    ]);
    expect(unit.state).toMatchObject({ longName: 'TL-0042', shortName: '0042', region: 16, wifiEnabled: false });
    expect(Array.from(unit.state.psk)).toEqual([1]);
    expect(startHubAction).toHaveBeenCalledWith('d-42', {
      action: 'FACTORY_RESET',
      nodeNum: NODE,
      confirmAssetTag: 'TL-0042',
    });
    expect(finishHubAction).toHaveBeenCalledWith('d-42', 'ha-1', { outcome: 'SUCCEEDED' });
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  it('restores the TrekLink defaults in one transaction and keeps the region (REQ-EVT-47)', async () => {
    // treklink a274 on 2026-11-06: channel 0 still carried the organization key of the provisioning of 11-03.
    const { unit } = dock({
      psk: KEY,
      longName: 'Org unit',
      shortName: 'ORG1',
      channelName: 'SAPA',
      wifiEnabled: true,
      region: 16,
      secondaryChannels: [{ index: 1, role: 2, name: 'SAPA-ADMIN', psk: KEY }],
    });
    unit.state.mqtt.enabled = true;
    const { result } = render();
    const id = await readyConnection();
    let outcome: Awaited<ReturnType<typeof result.current.restoreDefaults>> | undefined;
    await act(async () => {
      outcome = await result.current.restoreDefaults(id, RETURNED_UNIT);
    });
    expect(outcome).toMatchObject({ ok: true, wiped: true });
    expect(unit.writes.map((write) => write.variant)).toEqual([
      'begin_edit_settings',
      'set_owner',
      'set_channel',
      'set_channel',
      'set_config',
      'set_module_config',
      'commit_edit_settings',
    ]);
    expect(unit.state.secondaryChannels).toEqual([]);
    expect(unit.state).toMatchObject({
      longName: 'TL-0042',
      shortName: '0042',
      channelName: '',
      region: 16,
      wifiEnabled: false,
    });
    expect(unit.state.mqtt.enabled).toBe(false);
    expect(Array.from(unit.state.psk)).toEqual([1]);
    expect(startHubAction).toHaveBeenCalledWith('d-42', { action: 'RESTORE_DEFAULTS', nodeNum: NODE });
    expect(finishHubAction).toHaveBeenCalledWith('d-42', 'ha-1', { outcome: 'SUCCEEDED' });
  });

  it('names a secondary channel left on the unit and records the restore failed (REQ-ERR-34)', async () => {
    dock({ psk: KEY, secondaryChannels: [{ index: 2, role: 2, name: 'SAPA-ADMIN', psk: KEY }] }, { keepSecondaryChannelsOnCommit: true });
    const { result } = render();
    const id = await readyConnection();
    let outcome: Awaited<ReturnType<typeof result.current.restoreDefaults>> | undefined;
    await act(async () => {
      outcome = await result.current.restoreDefaults(id, RETURNED_UNIT);
    });
    expect(outcome).toMatchObject({ ok: false, failure: 'read-back', reason: 'The read-back differs: secondary channels off.' });
    expect(finishHubAction).toHaveBeenCalledWith('d-42', 'ha-1', {
      outcome: 'FAILED',
      failure: 'The read-back differs: secondary channels off.',
    });
  });

  it('writes nothing to another unit and records nothing (REQ-ERR-32)', async () => {
    const { unit } = dock({ nodeNum: 0x0004351c });
    const { result } = render();
    const id = await readyConnection();
    let outcome: Awaited<ReturnType<typeof result.current.factoryReset>> | undefined;
    await act(async () => {
      outcome = await result.current.factoryReset(id, RETURNED_UNIT);
    });
    expect(outcome).toMatchObject({ ok: false, failure: 'mismatch', wiped: false });
    expect(unit.writes).toEqual([]);
    expect(startHubAction).not.toHaveBeenCalled();
  });

  it('writes nothing when the server refuses the start without the typed asset tag (REQ-ERR-34)', async () => {
    const { unit } = dock();
    startHubAction.mockRejectedValue(
      new ApiError(400, 'CONFIRMATION_REQUIRED', 'Type TL-0042 to confirm: it is rented on RC-2026-0040.'),
    );
    const { result } = render();
    const id = await readyConnection();
    let outcome: Awaited<ReturnType<typeof result.current.factoryReset>> | undefined;
    await act(async () => {
      outcome = await result.current.factoryReset(id, RETURNED_UNIT);
    });
    expect(outcome).toMatchObject({
      ok: false,
      wiped: false,
      failure: 'api',
      reason: 'Type TL-0042 to confirm: it is rented on RC-2026-0040.',
    });
    expect(unit.writes).toEqual([]);
    expect(finishHubAction).not.toHaveBeenCalled();
  });

  it('refuses a unit reporting region UNSET before the wipe and records the action failed', async () => {
    const { unit } = dock({ region: 0 });
    const { result } = render();
    const id = await readyConnection();
    let outcome: Awaited<ReturnType<typeof result.current.factoryReset>> | undefined;
    await act(async () => {
      outcome = await result.current.factoryReset(id, RETURNED_UNIT);
    });
    const reason =
      'TL-0042 reports no LoRa region, so it could not be written back after the reset. Set its region first. Nothing was written.';
    expect(outcome).toMatchObject({ ok: false, wiped: false, failure: 'refused', reason });
    expect(unit.writes).toEqual([]);
    expect(finishHubAction).toHaveBeenCalledWith('d-42', 'ha-1', { outcome: 'FAILED', failure: reason });
  });

  it('names a read-back that differs and records the action failed with it (REQ-ERR-33)', async () => {
    const { unit } = dock({}, { loseRegionOnCommit: true });
    const { result } = render();
    const id = await readyConnection();
    let outcome: Awaited<ReturnType<typeof result.current.factoryReset>> | undefined;
    await act(async () => {
      outcome = await result.current.factoryReset(id, RETURNED_UNIT);
    });
    expect(outcome).toMatchObject({ ok: false, failure: 'read-back', reason: 'The read-back differs: region.' });
    expect(unit.writes[0].variant).toBe('factory_reset_config');
    expect(finishHubAction).toHaveBeenCalledWith('d-42', 'ha-1', {
      outcome: 'FAILED',
      failure: 'The read-back differs: region.',
    });
  });

  it('reports a server refusal of the finish as wiped, so the page says the record is missing', async () => {
    dock();
    finishHubAction.mockRejectedValue(new ApiError(409, 'HUB_ACTION_FINISHED', 'This hub action is already finished.'));
    const { result } = render();
    const id = await readyConnection();
    let outcome: Awaited<ReturnType<typeof result.current.factoryReset>> | undefined;
    await act(async () => {
      outcome = await result.current.factoryReset(id, RETURNED_UNIT);
    });
    expect(outcome).toMatchObject({
      ok: false,
      wiped: true,
      failure: 'api',
      reason: 'This hub action is already finished.',
    });
  });
});
