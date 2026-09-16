import * as mqtt from 'mqtt';
import pino from 'pino';
import { SQLitePriorityQueue } from '../queue/priority-queue';
import { gatewayConfig } from '../config';

const logger = pino({ name: 'GatewayMQTT' });

export class GatewayMqttClient {
  private client: mqtt.MqttClient | null = null;
  private isConnected = false;

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
      logger.warn('MQTT connection closed. Storing upcoming events offline in SQLite.');
    });

    this.client.on('error', (err) => {
      logger.error(`MQTT connection error: ${err.message}`);
    });
  }

  public flushQueue(): void {
    if (!this.isConnected || !this.client) return;

    const batch = this.queue.peek(gatewayConfig.queue.flushBatchSize);
    if (batch.length === 0) return;

    logger.info(`Flushing ${batch.length} prioritized events from offline SQLite queue...`);
    for (const item of batch) {
      const topic = `${gatewayConfig.mqtt.topicPrefix}/${item.priority}`;
      this.client.publish(topic, item.payload, { qos: gatewayConfig.mqtt.qos }, (err) => {
        if (!err) {
          this.queue.remove(item.id);
        } else {
          logger.error(`Failed to publish event ${item.eventId}: ${err.message}`);
        }
      });
    }
  }

  public disconnect(): void {
    if (this.client) {
      this.client.end();
    }
  }
}
