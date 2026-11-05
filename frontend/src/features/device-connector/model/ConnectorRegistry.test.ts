// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecognizedUnit } from '../../../entities/device/api';
import { openDock, type DockTimings } from '../../../shared/lib/meshtastic-dock';
import {
  FakePort,
  FakeSerial,
  FakeUnit,
  unitState,
  type UnitBehaviour,
} from '../../../shared/lib/meshtastic-dock.fake';
import {
  BUSY_TEXT,
  ConnectorRegistry,
  NOT_CHECKED_TEXT,
  NO_RESPONSE_TEXT,
  type RegistrySnapshot,
} from './ConnectorRegistry';

// The device connector's registry over the wire-level fake units (devices design section 12.4, task
// 10.6): several units at once, replug without the chooser, the rows a unit that answers nothing or a
// busy port gets, the one write lock, and a unit back from a restart on a new port keeping its row.

const TIMINGS: DockTimings = {
  handshakeMs: 600,
  writeMs: 500,
  restartDelayMs: 40,
  restartDeadlineMs: 300,
  retryMs: 20,
};
const A = 0xa4b1c2d4;
const B = 0xa4b1c2e5;

const unitAt = (serial: FakeSerial, nodeNum: number, behaviour: UnitBehaviour = {}) => {
  const unit = new FakeUnit(unitState({ nodeNum }), behaviour, serial);
  const port = new FakePort(unit, serial);
  serial.ports.push(port);
  return { unit, port };
};

const recognized = (nodeNum: number, assetTag: string | null): RecognizedUnit => ({
  nodeNum,
  nodeId: `!${nodeNum.toString(16)}`,
  device: assetTag ? ({ id: `d-${assetTag}`, assetTag, status: 'AVAILABLE' } as never) : null,
  contract: null,
  docked: null,
});

const until = async (registry: ConnectorRegistry, check: (snapshot: RegistrySnapshot) => boolean) => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (check(registry.getSnapshot())) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out: ${JSON.stringify(registry.getSnapshot().connections.map((c) => c.state))}`);
};

describe('ConnectorRegistry', () => {
  let serial: FakeSerial;
  let recognize: ReturnType<typeof vi.fn>;
  let registry: ConnectorRegistry;
  let consoleSpies: ReturnType<typeof vi.spyOn>[];

  beforeEach(() => {
    serial = new FakeSerial();
    Object.defineProperty(window.navigator, 'serial', { value: serial, configurable: true });
    recognize = vi.fn((nodeNums: number[]) =>
      Promise.resolve(nodeNums.map((nodeNum) => recognized(nodeNum, nodeNum === A ? 'TL-0042' : null))),
    );
    registry = new ConnectorRegistry({
      serial: () => serial as unknown as Serial,
      open: openDock,
      recognize,
      choose: () => serial.requestPort() as unknown as Promise<SerialPort>,
      timings: TIMINGS,
      unpluggedMs: 50,
      batchMs: 20,
    });
    consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => undefined),
    );
  });

  afterEach(() => {
    registry.stop();
    vi.restoreAllMocks();
    Reflect.deleteProperty(window.navigator, 'serial');
  });

  it('lists every granted unit without the chooser and asks the server once for both (AC-25)', async () => {
    unitAt(serial, A);
    unitAt(serial, B);

    await registry.start();
    await until(registry, (s) => s.connections.length === 2 && s.connections.every((c) => c.state === 'ready'));

    const rows = registry.getSnapshot().connections;
    expect(rows.map((row) => row.recognized?.device?.assetTag ?? 'unknown')).toEqual(['TL-0042', 'unknown']);
    expect(serial.requestCount).toBe(0);
    expect(recognize).toHaveBeenCalledTimes(1);
    expect(recognize.mock.calls[0][0]).toEqual(expect.arrayContaining([A, B]));
    // The handshake sessions are closed: the ports are free and nothing secret is held (REQ-UBI-08).
    expect(serial.ports.every((port) => port.readable === null)).toBe(true);
    expect(JSON.stringify(rows.map((row) => row.unit))).not.toMatch(/psk/i);
    expect(localStorage.length + sessionStorage.length).toBe(0);
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  it('removes an unplugged unit after a while and lists it again on replug, without the chooser', async () => {
    const { port } = unitAt(serial, A);
    await registry.start();
    await until(registry, (s) => s.connections[0]?.state === 'ready');

    port.detach();
    await until(registry, (s) => s.connections[0]?.state === 'unplugged');
    await until(registry, (s) => s.connections.length === 0);

    port.attached = true;
    serial.emit('connect', port);
    await until(registry, (s) => s.connections[0]?.state === 'ready');
    expect(serial.requestCount).toBe(0);
  });

  it('shows the no-response text for a unit that answers nothing and asks the server nothing (AC-33)', async () => {
    unitAt(serial, A, { silent: true });

    await registry.start();
    await until(registry, (s) => s.connections[0]?.state === 'no-response');

    expect(registry.getSnapshot().connections[0].message).toBe(NO_RESPONSE_TEXT);
    expect(recognize).not.toHaveBeenCalled();
  });

  it('shows a port another tab holds as busy, and Not checked when the server does not answer', async () => {
    const { port } = unitAt(serial, A);
    port.busy = true;
    await registry.start();
    await until(registry, (s) => s.connections[0]?.state === 'busy');
    expect(registry.getSnapshot().connections[0].message).toBe(BUSY_TEXT);

    port.busy = false;
    recognize.mockRejectedValueOnce(new Error('offline'));
    registry.retry(registry.getSnapshot().connections[0].id);
    await until(registry, (s) => s.connections[0]?.state === 'not-checked');
    expect(registry.getSnapshot().connections[0].message).toBe(NOT_CHECKED_TEXT);

    registry.retry(registry.getSnapshot().connections[0].id);
    await until(registry, (s) => s.connections[0]?.state === 'ready');
  });

  it('runs one write at a time and refuses a second while it runs (REQ-UBI-09)', async () => {
    unitAt(serial, A);
    unitAt(serial, B);
    await registry.start();
    await until(registry, (s) => s.connections.length === 2 && s.connections.every((c) => c.state === 'ready'));
    const [first, second] = registry.getSnapshot().connections;
    let release: () => void = () => undefined;

    const running = registry.withWriteLock(first.id, (_port, stage) => {
      stage('writing');
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    await until(registry, (s) => s.writing === first.id);

    await expect(registry.withWriteLock(second.id, () => Promise.resolve())).rejects.toThrow(
      'Another unit is being written.',
    );
    expect(registry.getSnapshot().connections[0].state).toBe('writing');
    release();
    await running;
    await until(registry, (s) => s.writing === null && s.connections[0].state === 'ready');
  });

  it('keeps the row of a unit that comes back from a restart on a new port', async () => {
    const { unit, port } = unitAt(serial, A);
    await registry.start();
    await until(registry, (s) => s.connections[0]?.state === 'ready');
    const id = registry.getSnapshot().connections[0].id;

    await registry.withWriteLock(id, async (_port, stage) => {
      stage('restarting');
      port.detach();
      const back = new FakePort(unit, serial, port.getInfo());
      serial.ports.push(back);
      serial.emit('connect', back);
    });
    await until(registry, (s) => s.connections.length === 1 && s.connections[0].state === 'ready');

    expect(registry.getSnapshot().connections[0].id).toBe(id);
    expect(registry.getSnapshot().connections[0].port).not.toBe(port);
  });
});

describe('ConnectorRegistry.returnedPort (design section 12.4 rule 1, review of the docking slice)', () => {
  const TIMINGS_FAST: DockTimings = { handshakeMs: 600, writeMs: 500, restartDelayMs: 40, restartDeadlineMs: 300, retryMs: 20 };

  it('takes the original port, else the one port with its USB IDs that no other row holds', async () => {
    const serial = new FakeSerial();
    Object.defineProperty(window.navigator, 'serial', { value: serial, configurable: true });
    const registry = new ConnectorRegistry({
      serial: () => serial as unknown as Serial,
      open: openDock,
      recognize: (nodeNums) => Promise.resolve(nodeNums.map((nodeNum) => recognized(nodeNum, null))),
      choose: () => serial.requestPort() as unknown as Promise<SerialPort>,
      timings: TIMINGS_FAST,
      batchMs: 5,
    });
    // Two units behind the same USB bridge share their IDs (both CP210x here).
    const a = unitAt(serial, A);
    unitAt(serial, B);
    await registry.start();
    await until(registry, (s) => s.connections.length === 2 && s.connections.every((c) => c.state === 'ready'));
    const rowA = registry.getSnapshot().connections.find((c) => c.unit?.nodeNum === A)!;

    await expect(registry.returnedPort(a.port as never, rowA.id)).resolves.toBe(a.port);

    // A drops its port on restart; B's port has the same IDs but belongs to B's row.
    a.port.detach();
    await expect(registry.returnedPort(a.port as never, rowA.id)).resolves.toBeNull();
    const back = new FakePort(a.unit, serial, a.port.getInfo());
    serial.ports.push(back);
    await expect(registry.returnedPort(a.port as never, rowA.id)).resolves.toBe(back);

    // A second unheld port with the same IDs makes it ambiguous: none is taken.
    const stranger = new FakeUnit(unitState({ nodeNum: 0x0badcafe }), {}, serial);
    serial.ports.push(new FakePort(stranger, serial, a.port.getInfo()));
    await expect(registry.returnedPort(a.port as never, rowA.id)).resolves.toBeNull();
    registry.stop();
    Reflect.deleteProperty(window.navigator, 'serial');
  });
});
