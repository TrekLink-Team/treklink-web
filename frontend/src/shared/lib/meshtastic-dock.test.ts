import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DockError,
  choosePort,
  isDockSupported,
  openDock,
  toNodeId,
  type DockSession,
  type DockTimings,
  type UplinkSettings,
} from './meshtastic-dock';
import { fakeDock, type UnitBehaviour, type UnitState } from './meshtastic-dock.fake';

// The adapter against a fake SerialPort that speaks the firmware's wire (devices design section 8.7).
// No hardware is involved; the hardware run on v3 and v4 is the leader's (tasks.md 7.2).

const TIMINGS: DockTimings = {
  handshakeMs: 600,
  writeMs: 700,
  restartDelayMs: 40,
  restartDeadlineMs: 800,
  retryMs: 20,
};
const KEY = Uint8Array.from({ length: 32 }, (_, index) => (index * 7 + 3) & 255);
const UPLINK: UplinkSettings = {
  wifiSsid: 'Base camp',
  wifiPassword: 'wifi-secret',
  brokerAddress: '192.168.1.20:1883',
  brokerUsername: 'treklink',
  brokerPassword: 'broker-secret',
  tls: false,
};

const sessions: DockSession[] = [];
const dock = (state: Partial<UnitState> = {}, behaviour: UnitBehaviour = {}) => {
  const setup = fakeDock(state, behaviour);
  vi.stubGlobal('navigator', { serial: setup.serial });
  return setup;
};
const open = async (port: unknown) => {
  const session = await openDock(port as SerialPort, TIMINGS);
  sessions.push(session);
  return session;
};
const failureOf = async (work: Promise<unknown>) => {
  try {
    await work;
  } catch (error) {
    if (error instanceof DockError) return { failure: error.failure, step: error.step };
    throw error;
  }
  throw new Error('expected a DockError');
};

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('meshtastic-dock', () => {
  it('reads the node, build, firmware and owner names, and no secret, with the config-only nonce', async () => {
    const { port, unit } = dock({ psk: KEY, wifiPsk: 'old-wifi' });
    const session = await open(port);
    expect(session.unit).toEqual({
      nodeNum: 0xa4b1c2d4,
      nodeId: '!a4b1c2d4',
      pioEnv: 'treklink-v3-tbeam',
      firmwareVersion: '2.7.26.a4aa98d',
      longName: 'Meshtastic c2d4',
      shortName: 'c2d4',
    });
    expect(unit.handshakes).toEqual([69420]);
    expect(session.primaryKeyEquals(KEY)).toBe(true);
    expect(session.primaryKeyEquals(new Uint8Array(32))).toBe(false);
    expect(JSON.stringify(session.unit)).not.toContain('old-wifi');
  });

  it('writes owner and channel 0 inside one edit transaction and reads them back after the restart', async () => {
    const { port, unit } = dock({ channelName: 'kept', uplinkEnabled: true });
    const session = await open(port);
    await session.writeOwnerAndChannel({ longName: 'TL-0042', shortName: '0042' }, KEY);
    expect(unit.writes.map((write) => write.variant)).toEqual([
      'begin_edit_settings',
      'set_owner',
      'set_channel',
      'commit_edit_settings',
    ]);
    // Everything but the PSK is kept as read: the channel name and the uplink flag survive.
    expect(unit.state).toMatchObject({ channelName: 'kept', uplinkEnabled: true });

    const back = await session.awaitRestart();
    expect(back).not.toBeNull();
    sessions.push(back as DockSession);
    expect(back?.unit).toMatchObject({ longName: 'TL-0042', shortName: '0042' });
    expect(back?.primaryKeyEquals(KEY)).toBe(true);
    // The v3 bridge kept the port: the same port was opened a second time.
    expect(port.openCount).toBe(2);
  });

  it('finds a native USB unit (v4) again on the port that returns after the restart', async () => {
    const { port, serial } = dock({}, { restart: 'port-returns', restartAfterMs: 10 });
    const session = await open(port);
    await session.writeOwnerAndChannel({ longName: 'TL-0007', shortName: '0007' }, KEY);
    const back = await session.awaitRestart();
    sessions.push(back as DockSession);
    expect(back?.unit.longName).toBe('TL-0007');
    expect(serial.ports.filter((candidate) => candidate.attached)).toHaveLength(1);
    expect(serial.ports[1].openCount).toBe(1);
  });

  it('answers null when the unit does not come back before the deadline', async () => {
    const { port } = dock({}, { restart: 'never-returns', restartAfterMs: 10 });
    const session = await open(port);
    await session.writeOwnerAndChannel({ longName: 'TL-0007', shortName: '0007' }, KEY);
    expect(await session.awaitRestart()).toBeNull();
  });

  it('names a unit that never answers as no-response (the v2 USB gap, REQ-ERR-14)', async () => {
    const { port } = dock({}, { silent: true });
    expect(await failureOf(openDock(port as unknown as SerialPort, TIMINGS))).toEqual({
      failure: 'no-response',
      step: 'read',
    });
    // The port is let go, so the next try can open it.
    expect(port.readable).toBeNull();
  });

  it('times out a write the unit does not acknowledge, and commits nothing', async () => {
    const { port, unit } = dock({}, { ignoreAdminWrite: 2 });
    const session = await open(port);
    expect(
      await failureOf(session.writeOwnerAndChannel({ longName: 'TL-1', shortName: 'TL-1' }, KEY)),
    ).toEqual({ failure: 'write-timeout', step: 'set_owner' });
    expect(unit.writes.map((write) => write.variant)).not.toContain('commit_edit_settings');
  });

  it('names a disconnect in the middle of the writes', async () => {
    const { port, unit } = dock({}, { dropOnAdminWrite: 3 });
    const session = await open(port);
    expect(
      await failureOf(session.writeOwnerAndChannel({ longName: 'TL-1', shortName: 'TL-1' }, KEY)),
    ).toEqual({ failure: 'disconnected', step: 'set_channel' });
    expect(unit.state.psk).toEqual(new Uint8Array([1]));
  });

  it('names a write the unit refuses', async () => {
    const { port } = dock({}, { refuseAdminWrite: 3 });
    const session = await open(port);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(
      await failureOf(session.writeOwnerAndChannel({ longName: 'TL-1', shortName: 'TL-1' }, KEY)),
    ).toEqual({ failure: 'write-refused', step: 'set_channel' });
  });

  it('names a port another app holds as busy', async () => {
    const { port } = dock();
    port.busy = true;
    expect(await failureOf(openDock(port as unknown as SerialPort, TIMINGS))).toEqual({
      failure: 'port-busy',
      step: 'open',
    });
  });

  it('writes the Stage A uplink in one transaction with the frozen values and reads it back', async () => {
    const { port, unit } = dock();
    const session = await open(port);
    await session.writeUplink(UPLINK);
    expect(unit.writes.map((write) => write.variant)).toEqual([
      'begin_edit_settings',
      'set_config',
      'set_module_config',
      'set_channel',
      'commit_edit_settings',
    ]);
    expect(unit.state).toMatchObject({
      wifiEnabled: true,
      wifiSsid: 'Base camp',
      wifiPsk: 'wifi-secret',
      // A network field the form does not name is kept as read.
      ntpServer: 'meshtastic.pool.ntp.org',
      uplinkEnabled: true,
      psk: new Uint8Array([1]),
      mqtt: {
        enabled: true,
        address: '192.168.1.20:1883',
        username: 'treklink',
        password: 'broker-secret',
        encryptionEnabled: false,
        jsonEnabled: true,
        tlsEnabled: false,
        root: 'treklink',
      },
    });
    const back = await session.awaitRestart();
    sessions.push(back as DockSession);
    expect(back?.uplinkDifferences(UPLINK)).toEqual([]);
  });

  it('names the uplink check a read-back fails', async () => {
    const { port } = dock({}, { loseMqttAddressOnCommit: true });
    const session = await open(port);
    await session.writeUplink(UPLINK);
    const back = await session.awaitRestart();
    sessions.push(back as DockSession);
    expect(back?.uplinkDifferences(UPLINK)).toEqual(['broker address']);
  });

  it('prints nothing to the console during a whole docking', async () => {
    const calls = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => undefined),
    );
    const { port } = dock();
    const session = await open(port);
    await session.writeOwnerAndChannel({ longName: 'TL-0042', shortName: '0042' }, KEY);
    const back = await session.awaitRestart();
    await back?.close();
    calls.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  it('asks the browser chooser for a new port', async () => {
    const { serial, port } = dock();
    expect(isDockSupported()).toBe(true);
    expect(await choosePort()).toBe(port);
    serial.chooserAnswer = null;
    expect(await failureOf(choosePort())).toEqual({ failure: 'no-port', step: 'choose port' });
    vi.stubGlobal('navigator', {});
    expect(isDockSupported()).toBe(false);
  });

  it('formats a node id as the firmware does', () => {
    expect(toNodeId(0x4351c)).toBe('!0004351c');
    expect(toNodeId(0xffffffff)).toBe('!ffffffff');
  });
});
