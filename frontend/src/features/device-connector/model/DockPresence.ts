import type { DockSessionView } from '../../../entities/device/api';
import type { RegistrySnapshot } from './ConnectorRegistry';

// The dock sessions behind the Staff map pin (devices design section 12.8, task 10.11, REQ-EVT-38): while
// the page context is the counter (decided Q3 A), every registered unit the connector holds has a session,
// renewed every third of its lifetime; a unit that leaves, or a context that is no longer the counter,
// ends it, and `pagehide` ends every session with a `keepalive` request so a closing tab still reaches
// the server. A session the server could not open is tried again on the next change.

export interface PresenceApi {
  open: (deviceId: string, nodeNum: number) => Promise<DockSessionView>;
  end: (deviceId: string, keepalive?: boolean) => Promise<unknown>;
}

interface Held {
  deviceId: string;
  nodeNum: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const MIN_RENEW_MS = 1000;

export class DockPresence {
  private readonly held = new Map<string, Held>();
  private stopped = false;

  constructor(private readonly api: PresenceApi) {}

  // The units that should have a session now, by device id.
  private wanted(snapshot: RegistrySnapshot, counter: boolean): Map<string, number> {
    const wanted = new Map<string, number>();
    if (!counter) return wanted;
    for (const connection of snapshot.connections) {
      const device = connection.recognized?.device;
      if (!device || !connection.unit || connection.state === 'unplugged') continue;
      wanted.set(device.id, connection.unit.nodeNum);
    }
    return wanted;
  }

  sync(snapshot: RegistrySnapshot, counter: boolean): void {
    if (this.stopped) return;
    const wanted = this.wanted(snapshot, counter);
    for (const [deviceId, held] of this.held) {
      if (wanted.get(deviceId) === held.nodeNum) continue;
      this.release(deviceId);
    }
    for (const [deviceId, nodeNum] of wanted) {
      if (!this.held.has(deviceId)) this.open(deviceId, nodeNum);
    }
  }

  private open(deviceId: string, nodeNum: number): void {
    const held: Held = { deviceId, nodeNum, timer: null };
    this.held.set(deviceId, held);
    this.api.open(deviceId, nodeNum).then(
      (session) => {
        if (this.held.get(deviceId) !== held) return;
        const life = Date.parse(session.expiresAt) - Date.parse(session.renewedAt);
        const delay = Math.max(MIN_RENEW_MS, Math.floor(life / 3));
        held.timer = setTimeout(() => {
          if (this.held.get(deviceId) !== held) return;
          this.held.delete(deviceId);
          this.open(deviceId, nodeNum);
        }, delay);
      },
      () => {
        // Not opened (offline, or the unit changed): forget it so the next change tries again.
        if (this.held.get(deviceId) === held) this.held.delete(deviceId);
      },
    );
  }

  private release(deviceId: string, keepalive = false): void {
    const held = this.held.get(deviceId);
    if (held?.timer) clearTimeout(held.timer);
    this.held.delete(deviceId);
    void this.api.end(deviceId, keepalive).catch(() => undefined);
  }

  // `pagehide` and sign-out: every session ends.
  stop(keepalive = false): void {
    for (const deviceId of [...this.held.keys()]) this.release(deviceId, keepalive);
    this.stopped = true;
  }

  get openDeviceIds(): string[] {
    return [...this.held.keys()];
  }
}
