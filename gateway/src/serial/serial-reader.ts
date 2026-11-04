import pino from 'pino';
import { gatewayConfig } from '../config';
import { SQLitePriorityQueue, PriorityTier } from '../queue/priority-queue';
import { FrameSimulator, tierOf, type StockPacket } from './simulator';
import { toStockPacket, type MeshPacketLike } from './stock-packet';

const logger = pino({ name: 'GatewaySerial' });

// A serial client the node does not hear from for 15 minutes times out (core's `heartbeat()`); one
// heartbeat every 5 minutes keeps the session with a wide margin (gateway-sync design §3.1).
export const HEARTBEAT_MS = 5 * 60_000;
// Packets heard before the node names itself wait for its number, at most this many.
const MAX_WAITING = 500;
// `DeviceStatusEnum.DeviceDisconnected` of @meshtastic/core.
const DEVICE_DISCONNECTED = 2;

export interface SerialParserConfig {
  port: string;
  baudRate: number;
  simulationMode: boolean;
  /** Wait before the port is opened again (REQ-ERR-07); `GATEWAY_SERIAL_RECONNECT_MS` by default. */
  reconnectMs?: number;
}

/** A frame as the reader handed it to the queue; the local page's state holder watches these. */
export interface HeardFrame {
  eventId: string;
  priority: PriorityTier;
  payload: object;
  /** Station clock, epoch ms, when the frame came off the port. */
  heardAt: number;
}

/** The serial side as the local page shows it (field-station-local-page.md, `/local/uplink`). */
export interface SerialStatus {
  port: string;
  simulation: boolean;
  /** True while frames are being read: the simulator is ticking, or the port is open. */
  reading: boolean;
  lastFrameAt: number | null;
}

interface Subscribable<T> {
  subscribe(listener: (value: T) => void): unknown;
}

/** What the reader uses of `MeshDevice` (@meshtastic/core), so a test can drive a real one or a stand-in. */
export interface MeshDeviceLike {
  events: {
    onMeshPacket: Subscribable<MeshPacketLike>;
    onMyNodeInfo: Subscribable<{ myNodeNum: number }>;
    onDeviceStatus: Subscribable<number>;
  };
  configure(): Promise<unknown>;
  setHeartbeatInterval(intervalMs: number): void;
  disconnect(): Promise<void>;
}

/** The transport of @meshtastic/core: frames from the node, bytes to it. */
export interface MeshTransport {
  toDevice: WritableStream<Uint8Array>;
  fromDevice: ReadableStream<unknown>;
  disconnect(): Promise<void>;
}

export interface SerialPortDeps {
  openTransport(port: string, baudRate: number): Promise<MeshTransport>;
  createDevice(transport: MeshTransport): MeshDeviceLike;
}

// The packages of design §3.1, loaded when a port is first opened: the simulation never loads the
// native serial binding. The Meshtastic ones are ES modules, which Node 22.12 or later `require`s from
// CommonJS. The port is opened here and handed to the transport open: `TransportNodeSerial.create`
// answers a failed open by closing the port that never opened, an unhandled error that ends the
// process, so a station started with its radio unplugged would stop instead of retrying (REQ-ERR-07).
export const meshtasticPort: SerialPortDeps = {
  async openTransport(path, baudRate) {
    const { SerialPort } = await import('serialport');
    const { TransportNodeSerial } = await import('@meshtastic/transport-node-serial');
    const port = new SerialPort({ path, baudRate, autoOpen: false });
    await new Promise<void>((resolve, reject) => port.open((err) => (err ? reject(err) : resolve())));
    return new TransportNodeSerial(port as never) as unknown as MeshTransport;
  },
  createDevice(transport) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { MeshDevice } = require('@meshtastic/core') as typeof import('@meshtastic/core');
    const device = new MeshDevice(transport as never);
    // The library logs every frame at its lowest level; the station keeps warnings and errors.
    (device.log.settings as { minLevel: number }).minLevel = 4;
    return device as unknown as MeshDeviceLike;
  },
};

export class SerialFrameReader {
  private timer: NodeJS.Timeout | null = null;
  private lastFrameAt: number | null = null;
  private device: MeshDeviceLike | null = null;
  private reopen: NodeJS.Timeout | null = null;
  private stationNode: number | null = null;
  private waiting: MeshPacketLike[] = [];
  private stopped = false;

  constructor(
    private config: SerialParserConfig,
    private queue: SQLitePriorityQueue,
    // Called after every enqueue, so a connected uplink publishes at once instead of waiting for
    // the next reconnect.
    private onEnqueued: () => void = () => undefined,
    // Called with every frame after its enqueue and before `onEnqueued`, so the local page's state sees
    // what the queue saw. An observer that throws is logged and never stops the queue or the flush.
    private onFrame: (frame: HeardFrame) => void = () => undefined,
    // The serial packages; a test passes a transport that replays recorded frames.
    private deps: SerialPortDeps = meshtasticPort,
  ) {}

  public status(): SerialStatus {
    return {
      port: this.config.port,
      simulation: this.config.simulationMode,
      reading: this.timer !== null || this.device !== null,
      lastFrameAt: this.lastFrameAt,
    };
  }

  /** The node on the port, once it has named itself; null in simulation and before. */
  public station(): number | null {
    return this.stationNode;
  }

  public start(): void {
    this.stopped = false;
    if (this.config.simulationMode) {
      logger.info('Starting Serial reader in SIMULATION mode (GATEWAY_SERIAL_SIMULATION=true, no port opened).');
      this.startSimulation();
    } else {
      void this.openPort();
    }
  }

  public async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.reopen) clearTimeout(this.reopen);
    this.reopen = null;
    const device = this.device;
    this.device = null;
    if (device) await device.disconnect().catch(() => undefined);
  }

  // Every tick the simulated nodes hand their packets to the queue exactly as a node on the USB port
  // would: the queue holds them while the uplink is down and flushes them by tier when it is back.
  private startSimulation(): void {
    const simulation = gatewayConfig.simulation;
    const simulator = new FrameSimulator(simulation);
    logger.info(
      `Simulating ${simulation.nodes.join(', ')} every ${simulation.intervalMs} ms` +
        (simulation.sosEvery > 0 ? `, an SOS every ${simulation.sosEvery} ticks.` : '.'),
    );
    this.timer = setInterval(() => {
      for (const packet of simulator.next()) this.enqueuePacket(packet);
    }, simulation.intervalMs);
  }

  // Design §3.1: open the port, ask the node for its configuration (until then it writes only its
  // debug log), keep the session with a heartbeat, and turn every decoded packet into the stock JSON
  // shape. A port that fails or closes is opened again after the reconnect wait (REQ-ERR-07).
  private async openPort(): Promise<void> {
    if (this.stopped) return;
    const { port, baudRate } = this.config;
    logger.info(`Opening serial port ${port} at ${baudRate} baud.`);
    let device: MeshDeviceLike;
    try {
      const transport = await this.deps.openTransport(port, baudRate);
      if (this.stopped) {
        await transport.disconnect().catch(() => undefined);
        return;
      }
      device = this.deps.createDevice(transport);
    } catch (err) {
      this.lost(null, `cannot open ${port}: ${(err as Error).message}`);
      return;
    }
    this.device = device;
    device.events.onMyNodeInfo.subscribe((info) => this.named(info.myNodeNum));
    device.events.onMeshPacket.subscribe((packet) => this.heard(packet));
    device.events.onDeviceStatus.subscribe((status) => {
      if (status === DEVICE_DISCONNECTED) this.lost(device, `${port} closed`);
    });
    device.setHeartbeatInterval(HEARTBEAT_MS);
    // The request resolves when the node answers or the library's own wait ends; packets arrive
    // through the events either way.
    device.configure().catch((err: unknown) => {
      logger.warn(`Configuration request to ${port} failed: ${(err as Error).message ?? String(err)}`);
    });
    logger.info(`Reading the node on ${port}.`);
  }

  private lost(device: MeshDeviceLike | null, reason: string): void {
    // A status from a device already replaced, or the stop's own disconnect, changes nothing.
    if (this.stopped || (device !== null && device !== this.device)) return;
    this.device = null;
    if (device) void device.disconnect().catch(() => undefined);
    if (this.reopen) return;
    const wait = this.config.reconnectMs ?? gatewayConfig.serial.reconnectMs;
    logger.warn(`Serial reader not reading: ${reason}. Opening the port again in ${wait} ms.`);
    this.reopen = setTimeout(() => {
      this.reopen = null;
      void this.openPort();
    }, wait);
  }

  private named(nodeNum: number): void {
    this.stationNode = nodeNum;
    const waiting = this.waiting;
    this.waiting = [];
    for (const packet of waiting) this.heard(packet);
  }

  private heard(packet: MeshPacketLike): void {
    if (this.stationNode === null) {
      if (this.waiting.length < MAX_WAITING) this.waiting.push(packet);
      return;
    }
    const result = toStockPacket(packet, this.stationNode);
    if (result.kind === 'skipped') {
      logger.debug(`Skipped packet ${packet.id} from ${packet.from}: ${result.reason}.`);
      return;
    }
    this.enqueuePacket(result.packet);
  }

  private enqueuePacket(packet: StockPacket): void {
    this.handleFrame(packet.sender, String(packet.from), packet.id, tierOf(packet), packet);
  }

  /**
   * Ingests a raw or decoded Meshtastic frame and enqueues it with calculated priority tier.
   */
  public handleFrame(
    deviceId: string,
    sessionId: string,
    sequenceNumber: number,
    priority: PriorityTier,
    payload: object,
  ): void {
    const eventId = `${deviceId}:${sessionId}:${sequenceNumber}`;
    this.queue.enqueue(eventId, priority, payload);
    logger.info(`Enqueued event ${eventId} with priority tier ${priority}`);
    this.lastFrameAt = Date.now();
    try {
      this.onFrame({ eventId, priority, payload, heardAt: this.lastFrameAt });
    } catch (err) {
      logger.error(`Local page state not updated for ${eventId}: ${(err as Error).message}`);
    }
    this.onEnqueued();
  }
}
