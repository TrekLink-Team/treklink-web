import * as mqtt from 'mqtt';
import pino from 'pino';
import { SQLitePriorityQueue } from '../queue/priority-queue';
import { gatewayConfig } from '../config';

const logger = pino({ name: 'GatewayMQTT' });

export class GatewayMqttClient {
  private client: mqtt.MqttClient | null = null;
  private isConnected = false;
  private flushing = false;

  constructor(
    private brokerUrl: string = gatewayConfig.mqtt.brokerUrl,
    private queue: SQLitePriorityQueue,
  ) {}

  public connect(): void {
    logger.info(`Connecting to MQTT broker at ${this.brokerUrl}...`);
    this.client = mqtt.connect(this.brokerUrl, {
      clientId: `${gatewayConfig.mqtt.clientIdPrefix}-${Math.random().toString(16).substring(2, 8)}`,
      reconnectPeriod: gatewayConfig.mqtt.reconnectPeriodMs,
    });

    this.client.on('connect', () => {
      this.isConnected = true;
      logger.info('Connected to MQTT broker. Triggering queue flush...');
      this.flushQueue();
    });

    this.client.on('close', () => {
      this.isConnected = false;
      this.flushing = false;
      logger.warn('MQTT connection closed. Storing upcoming events offline in SQLite.');
    });

    this.client.on('error', (err) => {
      logger.error(`MQTT connection error: ${err.message}`);
    });
  }

  // The node's own uplink topic for a queued packet (Stage B, D-005): `<prefix>/<channel>/<sender>`.
  private topicOf(payload: string): string | null {
    try {
      const sender = (JSON.parse(payload) as { sender?: unknown }).sender;
      return typeof sender === 'string' && sender !== ''
        ? `${gatewayConfig.mqtt.topicPrefix}/${gatewayConfig.mqtt.channelName}/${sender}`
        : null;
    } catch {
      return null;
    }
  }

  // Publishes one batch in tier order and waits for every acknowledgement, then takes the next batch
  // until the queue is empty. One flush runs at a time, so a row is never published twice by two
  // overlapping flushes; a row whose publish failed stays queued for the next flush.
  public flushQueue(): void {
    if (!this.isConnected || !this.client || this.flushing) return;
    const batch = this.queue.peek(gatewayConfig.queue.flushBatchSize);
    if (batch.length === 0) return;

    this.flushing = true;
    logger.info(`Flushing ${batch.length} prioritized events from the SQLite queue...`);
    let pending = batch.length;
    let failed = false;
    const done = () => {
      pending -= 1;
      if (pending > 0) return;
      this.flushing = false;
      if (!failed) this.flushQueue();
    };
    for (const item of batch) {
      const topic = this.topicOf(item.payload);
      if (!topic) {
        logger.error(`Dropping event ${item.eventId}: its packet has no sender to publish under.`);
        this.queue.remove(item.id);
        done();
        continue;
      }
      this.client.publish(topic, item.payload, { qos: gatewayConfig.mqtt.qos }, (err) => {
        if (!err) {
          this.queue.remove(item.id);
        } else {
          failed = true;
          logger.error(`Failed to publish event ${item.eventId}: ${err.message}`);
        }
        done();
      });
    }
  }

  public disconnect(): void {
    if (this.client) {
      this.client.end();
    }
  }
}
