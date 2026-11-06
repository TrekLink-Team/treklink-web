import type { RecognizedUnit } from '../../../entities/device/api';
import {
  DEFAULT_TIMINGS,
  DockError,
  choosePort,
  openDock,
  type DockSession,
  type DockTimings,
  type UnitReading,
} from '../../../shared/lib/meshtastic-dock';

// The device connector's registry (devices design section 12.2 and 12.4, task 10.6): one per tab,
// outside React, holding one connection per USB port the site may use. It is the only place that
// enumerates or opens ports; the actions borrow a port from it under one write lock (REQ-UBI-09).
//
// A connection keeps the port handle and the unit's identity only (REQ-UBI-08). The handshake session,
// which carries the channel settings, is closed as soon as the identity is read; a write opens its own
// session and reads the primary channel again inside its own transaction (design section 12.4 rule 2).
// Nothing here is written to browser storage, the query cache or the console.

export type ConnectionState =
  | 'reading'
  | 'looking-up'
  | 'ready'
  | 'no-response'
  | 'busy'
  | 'not-checked'
  | 'failed'
  | 'unplugged'
  // The stages of a write in progress (design section 8.4 and 8.8).
  | 'getting-key'
  | 'writing'
  | 'restarting'
  | 'reconnect'
  | 'checking';

export interface Connection {
  id: number;
  port: SerialPort;
  state: ConnectionState;
  unit: UnitReading | null;
  // The answer of devices api-design 30, or null before it.
  recognized: RecognizedUnit | null;
  // The text shown for a state that needs one (a failure, a refusal).
  message: string | null;
}

export interface RegistrySnapshot {
  supported: boolean;
  connections: readonly Connection[];
  // The connection a write runs on, or null (REQ-STA-06).
  writing: number | null;
  // The connection whose unit did not come back by itself after its restart, while the docking waits for
  // Staff to reconnect it (screen 4.6, Reconnect); null otherwise.
  reconnectFor: number | null;
}

export interface ReconnectOffer {
  connectionId: number;
  reconnect: () => Promise<void>;
  stop: () => void;
}

export interface RegistryDeps {
  serial: () => Serial | null;
  open: (port: SerialPort, timings: DockTimings) => Promise<DockSession>;
  recognize: (nodeNums: readonly number[]) => Promise<RecognizedUnit[]>;
  choose: () => Promise<SerialPort>;
  timings?: DockTimings;
  // How long an unplugged row stays before it leaves the list (design section 12.4 rule 5).
  unpluggedMs?: number;
  // Recognition batches the units that finish their handshake within this window (design section 12.5).
  batchMs?: number;
}

export const NO_RESPONSE_TEXT =
  "No response over USB. This unit's firmware has no USB console; update it or enter the node number manually.";
export const BUSY_TEXT = 'In use by another tab or app.';
export const NOT_CHECKED_TEXT = 'Not checked: the server did not answer.';

const serialOf = (): Serial | null =>
  typeof navigator !== 'undefined' && 'serial' in navigator ? navigator.serial : null;

export class ConnectorRegistry {
  private connections: Connection[] = [];
  private snapshot: RegistrySnapshot;
  private readonly listeners = new Set<() => void>();
  private nextId = 1;
  private writing: number | null = null;
  private offer: ReconnectOffer | null = null;
  private deferred: SerialPort[] = [];
  private readonly reads = new Map<number, Promise<void>>();
  private readonly removals = new Map<number, ReturnType<typeof setTimeout>>();
  private pending: { nodeNum: number; resolve: (unit: RecognizedUnit | null) => void; reject: (error: unknown) => void }[] = [];
  private batch: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private readonly timings: DockTimings;
  private readonly unpluggedMs: number;
  private readonly batchMs: number;

  constructor(private readonly deps: RegistryDeps) {
    this.timings = deps.timings ?? DEFAULT_TIMINGS;
    this.unpluggedMs = deps.unpluggedMs ?? 10_000;
    this.batchMs = deps.batchMs ?? 300;
    this.snapshot = {
      supported: deps.serial() !== null,
      connections: [],
      writing: null,
      reconnectFor: null,
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): RegistrySnapshot => this.snapshot;

  // Opens every granted port without the chooser and follows `connect` and `disconnect` (REQ-EVT-31).
  async start(): Promise<void> {
    const api = this.deps.serial();
    if (this.started || !api) return;
    this.started = true;
    api.addEventListener('connect', this.onConnect);
    api.addEventListener('disconnect', this.onDisconnect);
    for (const port of await api.getPorts()) this.attach(port);
  }

  stop(): void {
    const api = this.deps.serial();
    api?.removeEventListener('connect', this.onConnect);
    api?.removeEventListener('disconnect', this.onDisconnect);
    this.started = false;
  }

  // Connect a unit: the browser's chooser, which needs a user gesture.
  async connectNew(): Promise<number | null> {
    let port: SerialPort;
    try {
      port = await this.deps.choose();
    } catch {
      return null;
    }
    return this.attach(port);
  }

  // Adds a port as a row and reads it; a port already listed is read again only after a failure.
  attach(port: SerialPort): number | null {
    if (this.writing !== null) {
      if (!this.deferred.includes(port)) this.deferred.push(port);
      return null;
    }
    const existing = this.connections.find((connection) => connection.port === port);
    if (existing) {
      this.cancelRemoval(existing.id);
      if (existing.state === 'unplugged' || existing.state === 'failed') void this.read(existing.id);
      return existing.id;
    }
    const id = this.nextId++;
    this.connections.push({ id, port, state: 'reading', unit: null, recognized: null, message: null });
    this.emit();
    void this.read(id);
    return id;
  }

  // Reads the unit again (Retry), or only asks the server again when the read itself succeeded.
  retry(id: number): void {
    const connection = this.get(id);
    if (!connection) return;
    if (connection.state === 'not-checked' && connection.unit) {
      void this.lookUp(id, connection.unit.nodeNum);
      return;
    }
    void this.read(id);
  }

  // Asks the server again for a connection's unit, after an action changed it.
  async refreshRecognition(id: number): Promise<void> {
    const connection = this.get(id);
    if (connection?.unit) await this.lookUp(id, connection.unit.nodeNum);
  }

  // Asks the server again for every read unit (devices design section 12.14, REQ-EVT-49): Refresh, and after a
  // change made elsewhere (a registration, a provisioning, a quick swap). One batched request.
  async refreshAll(): Promise<void> {
    await Promise.all(
      this.connections
        .filter((connection) => connection.unit && connection.state !== 'unplugged')
        .map((connection) => this.lookUp(connection.id, (connection.unit as UnitReading).nodeNum)),
    );
  }

  // Forget: the row leaves and, where the browser has it, the grant is withdrawn.
  async forget(id: number): Promise<void> {
    const connection = this.get(id);
    if (!connection) return;
    this.remove(id);
    const port = connection.port as SerialPort & { forget?: () => Promise<void> };
    await port.forget?.().catch(() => undefined);
  }

  get(id: number): Connection | undefined {
    return this.connections.find((connection) => connection.id === id);
  }

  // The ready connection of a unit, for an entry point that names its device (REQ-EVT-41).
  byNodeNum(nodeNum: number | null | undefined): Connection | undefined {
    if (nodeNum === null || nodeNum === undefined) return undefined;
    return this.connections.find(
      (connection) => connection.unit?.nodeNum === nodeNum && connection.state !== 'unplugged',
    );
  }

  // The port a unit came back on after the restart of a write (design section 12.4 rule 1): the original
  // port while it is still granted, else the one granted port with its USB IDs that no other row holds.
  // Two units on the same USB bridge share their IDs, so with several candidates none is taken and the
  // docking asks Staff to reconnect the unit instead of writing to the wrong one.
  async returnedPort(original: SerialPort, connectionId: number): Promise<SerialPort | null> {
    const ports = (await this.deps.serial()?.getPorts()) ?? [];
    if (ports.includes(original)) return original;
    const info = original.getInfo();
    const held = new Set(
      this.connections
        .filter((connection) => connection.id !== connectionId && connection.state !== 'unplugged')
        .map((connection) => connection.port),
    );
    const candidates = ports.filter((port) => {
      const other = port.getInfo();
      return (
        !held.has(port) &&
        other.usbVendorId === info.usbVendorId &&
        other.usbProductId === info.usbProductId
      );
    });
    return candidates.length === 1 ? candidates[0] : null;
  }

  // Runs one write on a connection's port under the one lock (REQ-UBI-09, REQ-STA-06). The connection
  // shows the stages the work reports; afterwards ports that arrived meanwhile (a unit back from its
  // restart) are read, and the connection is read again so its row shows the unit as it is now.
  async withWriteLock<T>(
    id: number,
    work: (port: SerialPort, stage: (state: ConnectionState) => void) => Promise<T>,
  ): Promise<T> {
    const connection = this.get(id);
    if (!connection) throw new Error('The unit is no longer connected.');
    if (this.writing !== null) throw new Error('Another unit is being written.');
    await this.reads.get(id);
    this.writing = id;
    this.update(id, { message: null });
    try {
      return await work(connection.port, (state) => this.update(id, { state }));
    } finally {
      this.writing = null;
      this.emit();
      await this.afterWrite(id);
    }
  }

  private async afterWrite(id: number): Promise<void> {
    const ports = (await this.deps.serial()?.getPorts()) ?? [];
    const connection = this.get(id);
    const deferred = this.deferred;
    this.deferred = [];
    const original = connection?.port;
    if (connection && original && ports.includes(original)) {
      this.update(id, { state: 'reading' });
      void this.read(id);
    } else if (connection) {
      // Waiting for the unit: a port that arrived meanwhile and answers its node number joins this row.
      this.update(id, { state: 'reading', message: null });
    }
    const arrived = deferred
      .filter((port) => !this.connections.some((other) => other.port === port))
      .map((port) => this.attach(port))
      .filter((other): other is number => other !== null);
    await Promise.all(arrived.map((other) => this.reads.get(other)));
    const after = this.get(id);
    if (after && original && after.port === original && !ports.includes(original)) {
      this.markUnplugged(id);
    }
  }

  private read(id: number): Promise<void> {
    const work = this.doRead(id).finally(() => this.reads.delete(id));
    this.reads.set(id, work);
    return work;
  }

  private async doRead(id: number): Promise<void> {
    const connection = this.get(id);
    if (!connection) return;
    this.update(id, { state: 'reading', message: null });
    let unit: UnitReading;
    try {
      const session = await this.deps.open(connection.port, this.timings);
      unit = session.unit;
      // Drops the channel settings with the session (REQ-UBI-08).
      await session.close();
    } catch (error) {
      if (!this.get(id)) return;
      if (error instanceof DockError && error.failure === 'no-response') {
        this.update(id, { state: 'no-response', message: NO_RESPONSE_TEXT });
      } else if (error instanceof DockError && error.failure === 'port-busy') {
        this.update(id, { state: 'busy', message: BUSY_TEXT });
      } else if (error instanceof DockError && error.failure === 'disconnected') {
        this.markUnplugged(id);
      } else {
        this.update(id, {
          state: 'failed',
          message: error instanceof Error ? error.message : 'The unit could not be read.',
        });
      }
      return;
    }
    // A unit back from a restart on a new port keeps its row (design section 12.4 rule 1).
    const twin = this.connections.find(
      (other) => other.id !== id && other.unit?.nodeNum === unit.nodeNum,
    );
    if (twin) {
      const port = this.get(id)?.port;
      this.remove(id);
      if (port) this.update(twin.id, { port });
      this.cancelRemoval(twin.id);
      this.update(twin.id, { unit });
      await this.lookUp(twin.id, unit.nodeNum);
      return;
    }
    this.update(id, { unit });
    await this.lookUp(id, unit.nodeNum);
  }

  private async lookUp(id: number, nodeNum: number): Promise<void> {
    this.update(id, { state: 'looking-up', message: null });
    try {
      const recognized = await this.recognizeBatched(nodeNum);
      this.update(id, { state: 'ready', recognized, message: null });
    } catch {
      this.update(id, { state: 'not-checked', message: NOT_CHECKED_TEXT });
    }
  }

  private recognizeBatched(nodeNum: number): Promise<RecognizedUnit | null> {
    return new Promise((resolve, reject) => {
      this.pending.push({ nodeNum, resolve, reject });
      this.batch ??= setTimeout(() => void this.flush(), this.batchMs);
    });
  }

  private async flush(): Promise<void> {
    const pending = this.pending;
    this.pending = [];
    this.batch = null;
    const nodeNums = [...new Set(pending.map((entry) => entry.nodeNum))];
    try {
      const answer = await this.deps.recognize(nodeNums);
      for (const entry of pending) {
        entry.resolve(answer.find((unit) => unit.nodeNum === entry.nodeNum) ?? null);
      }
    } catch (error) {
      for (const entry of pending) entry.reject(error);
    }
  }

  private readonly onConnect = (event: Event) => {
    const port = (event as Event & { port?: SerialPort }).port ?? (event.target as SerialPort);
    if (port) this.attach(port);
  };

  private readonly onDisconnect = (event: Event) => {
    const port = (event as Event & { port?: SerialPort }).port ?? (event.target as SerialPort);
    const connection = this.connections.find((candidate) => candidate.port === port);
    // A write handles its own restart (the unit drops its port on purpose).
    if (!connection || connection.id === this.writing) return;
    this.markUnplugged(connection.id);
  };

  private markUnplugged(id: number): void {
    this.update(id, { state: 'unplugged', message: null });
    this.cancelRemoval(id);
    this.removals.set(
      id,
      setTimeout(() => this.remove(id), this.unpluggedMs),
    );
  }

  private cancelRemoval(id: number): void {
    const timer = this.removals.get(id);
    if (timer) clearTimeout(timer);
    this.removals.delete(id);
  }

  private remove(id: number): void {
    this.cancelRemoval(id);
    this.connections = this.connections.filter((connection) => connection.id !== id);
    this.emit();
  }

  private update(id: number, change: Partial<Connection>): void {
    let changed = false;
    this.connections = this.connections.map((connection) => {
      if (connection.id !== id) return connection;
      changed = true;
      return { ...connection, ...change };
    });
    if (changed) this.emit();
  }

  // The docking that waits for a reconnect offers its Reconnect and Stop here, so the panel row shows them
  // too; null withdraws the offer.
  offerReconnect(offer: ReconnectOffer | null): void {
    this.offer = offer;
    this.emit();
  }

  get reconnectOffer(): ReconnectOffer | null {
    return this.offer;
  }

  private emit(): void {
    this.snapshot = {
      supported: this.deps.serial() !== null,
      connections: this.connections,
      writing: this.writing,
      reconnectFor: this.offer?.connectionId ?? null,
    };
    for (const listener of this.listeners) listener();
  }
}

// The registry of this tab, created on first use.
let shared: ConnectorRegistry | null = null;

export const connectorRegistry = (
  recognize: (nodeNums: readonly number[]) => Promise<RecognizedUnit[]>,
  timings?: DockTimings,
): ConnectorRegistry => {
  shared ??= new ConnectorRegistry({
    serial: serialOf,
    open: openDock,
    recognize,
    choose: choosePort,
    timings,
  });
  return shared;
};

// Tests replace the shared registry between cases.
export const resetConnectorRegistry = (): void => {
  shared?.stop();
  shared = null;
};
