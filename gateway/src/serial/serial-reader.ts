import pino from 'pino';
import { gatewayConfig } from '../config';
import { SQLitePriorityQueue, PriorityTier } from '../queue/priority-queue';
import { FrameSimulator, tierOf } from './simulator';

const logger = pino({ name: 'GatewaySerial' });

export interface SerialParserConfig {
  port: string;
  baudRate: number;
  simulationMode: boolean;
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
  /** True while frames are being read: the simulator is ticking. The hardware reader is still a stub. */
  reading: boolean;
  lastFrameAt: number | null;
}

export class SerialFrameReader {
  private timer: NodeJS.Timeout | null = null;
  private lastFrameAt: number | null = null;

  constructor(
    private config: SerialParserConfig,
    private queue: SQLitePriorityQueue,
    // Called after every enqueue, so a connected uplink publishes at once instead of waiting for
    // the next reconnect.
    private onEnqueued: () => void = () => undefined,
    // Called with every frame after its enqueue and before `onEnqueued`, so the local page's state sees
    // what the queue saw. An observer that throws is logged and never stops the queue or the flush.
    private onFrame: (frame: HeardFrame) => void = () => undefined,
  ) {}

  public status(): SerialStatus {
    return {
      port: this.config.port,
      simulation: this.config.simulationMode,
      reading: this.timer !== null,
      lastFrameAt: this.lastFrameAt,
    };
  }

  public start(): void {
    if (this.config.simulationMode) {
      logger.info('Starting Serial reader in SIMULATION mode (no physical hardware required).');
      this.startSimulation();
    } else {
      logger.info(`Opening physical serial port ${this.config.port} @ ${this.config.baudRate}...`);
      // Hardware serial listener implementation stub for Meshtastic protobuf frames
    }
  }

  public stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
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
      for (const packet of simulator.next()) {
        this.handleFrame(packet.sender, String(packet.from), packet.id, tierOf(packet), packet);
      }
    }, simulation.intervalMs);
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
