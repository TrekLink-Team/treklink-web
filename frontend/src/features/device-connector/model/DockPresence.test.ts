import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection, RegistrySnapshot } from './ConnectorRegistry';
import { DockPresence } from './DockPresence';

// The dock session heartbeat (devices design section 12.8, REQ-EVT-38): open in the counter context,
// renew every third of the lifetime, end when the unit or the context leaves, and on pagehide.

const connection = (id: number, deviceId: string | null, state: Connection['state'] = 'ready'): Connection => ({
  id,
  port: {} as SerialPort,
  state,
  unit: { nodeNum: 100 + id, nodeId: '', pioEnv: null, firmwareVersion: null, longName: '', shortName: '' },
  recognized: {
    nodeNum: 100 + id,
    nodeId: '',
    device: deviceId ? ({ id: deviceId } as never) : null,
    contract: null,
    docked: null,
  },
  message: null,
});

const snapshot = (...connections: Connection[]): RegistrySnapshot => ({
  supported: true,
  connections,
  writing: null,
  reconnectFor: null,
});

describe('DockPresence', () => {
  let api: { open: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  let presence: DockPresence;

  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-11-04T03:00:00.000Z') });
    api = {
      open: vi.fn(() =>
        Promise.resolve({
          deviceId: 'd',
          assetTag: 'TL',
          since: '2026-11-04T03:00:00.000Z',
          renewedAt: '2026-11-04T03:00:00.000Z',
          expiresAt: '2026-11-04T03:00:30.000Z',
        }),
      ),
      end: vi.fn(() => Promise.resolve(null)),
    };
    presence = new DockPresence(api);
  });

  afterEach(() => vi.useRealTimers());

  it('opens a session only for registered units held in the counter context', async () => {
    presence.sync(snapshot(connection(1, 'd-42'), connection(2, null)), false);
    expect(api.open).not.toHaveBeenCalled();

    presence.sync(snapshot(connection(1, 'd-42'), connection(2, null)), true);
    await vi.waitFor(() => expect(api.open).toHaveBeenCalledWith('d-42', 101));
    expect(api.open).toHaveBeenCalledTimes(1);
  });

  it('renews every third of the lifetime the server answers', async () => {
    presence.sync(snapshot(connection(1, 'd-42')), true);
    await vi.waitFor(() => expect(api.open).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(10_000);
    expect(api.open).toHaveBeenCalledTimes(2);
  });

  it('ends the session when the unit is unplugged or the page is no longer the counter', async () => {
    presence.sync(snapshot(connection(1, 'd-42')), true);
    await vi.waitFor(() => expect(api.open).toHaveBeenCalledTimes(1));

    presence.sync(snapshot(connection(1, 'd-42', 'unplugged')), true);
    expect(api.end).toHaveBeenCalledWith('d-42', false);

    presence.sync(snapshot(connection(1, 'd-42')), true);
    await vi.waitFor(() => expect(api.open).toHaveBeenCalledTimes(2));
    presence.sync(snapshot(connection(1, 'd-42')), false);
    expect(api.end).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(api.open).toHaveBeenCalledTimes(2);
  });

  it('ends every session with keepalive on pagehide', async () => {
    presence.sync(snapshot(connection(1, 'd-42'), connection(2, 'd-43')), true);
    await vi.waitFor(() => expect(api.open).toHaveBeenCalledTimes(2));

    presence.stop(true);

    expect(api.end).toHaveBeenCalledWith('d-42', true);
    expect(api.end).toHaveBeenCalledWith('d-43', true);
  });
});
