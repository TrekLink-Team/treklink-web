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

export class SerialFrameReader {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private config: SerialParserConfig,
    private queue: SQLitePriorityQueue,
    // Called after every enqueue, so a connected uplink publishes at once instead of waiting for
    // the next reconnect.
    private onEnqueued: () => void = () => undefined,
  ) {}

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
    this.onEnqueued();
  }
}
