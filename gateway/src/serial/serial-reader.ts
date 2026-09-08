import pino from 'pino';
import { SQLitePriorityQueue, PriorityTier } from '../queue/priority-queue';

const logger = pino({ name: 'GatewaySerial' });

export interface SerialParserConfig {
  port: string;
  baudRate: number;
  simulationMode: boolean;
}

export class SerialFrameReader {
  constructor(
    private config: SerialParserConfig,
    private queue: SQLitePriorityQueue,
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

  private startSimulation(): void {
    logger.info('Serial simulation ready for simulated Meshtastic Protocol Buffer frames.');
  }

  /**
   * Ingests a raw or decoded Meshtastic frame and enqueues it with calculated priority tier.
   */
  public handleFrame(deviceId: string, sessionId: string, sequenceNumber: number, priority: PriorityTier, payload: object): void {
    const eventId = `${deviceId}:${sessionId}:${sequenceNumber}`;
    this.queue.enqueue(eventId, priority, payload);
    logger.info(`Enqueued event ${eventId} with priority tier ${priority}`);
  }
}
