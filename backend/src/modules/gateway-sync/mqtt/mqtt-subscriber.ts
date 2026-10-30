import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connect, MqttClient } from 'mqtt';
import { ValidatedEnvironment } from '../../platform/config/environment-variables';
import { MQTT_HEALTH_PROBE } from '../../platform/ports';
import { NodeJsonAdapter } from '../adapters/node-json.adapter';
import { IngestionService } from '../ingestion.service';
import { StationHealthHandler } from '../station-health.handler';
import { MqttConnectionState } from './mqtt-connection-state';
import { backoffMs, isTransientDatabaseError } from './retry';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// The backend's MQTT subscriber (task 1.1). QoS 1 on a persistent session; mqtt.js sends the PUBACK only
// after `handleMessage` calls back, and handles one message at a time, so a message is acknowledged only
// after ingestion committed and a crash mid-transaction gets it redelivered (design §2).
//
// It subscribes to the node topic and to the Field Station health topic `<root>/fs/+/health` (task 2.5,
// health part). The Field Station event topic `<root>/fs/+/2/json/+/+` joins with the station adapter
// (task 2.1, Sprint 4, D-058 rule 2).
@Injectable()
export class MqttSubscriber implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(MqttSubscriber.name);
  private client?: MqttClient;
  private stopping = false;

  constructor(
    private readonly config: ConfigService<ValidatedEnvironment, true>,
    private readonly adapter: NodeJsonAdapter,
    private readonly ingestion: IngestionService,
    @Optional() @Inject(MQTT_HEALTH_PROBE) private readonly state?: MqttConnectionState | null,
    @Optional() private readonly stationHealth?: StationHealthHandler,
  ) {}

  private get subscriptions(): string[] {
    return [
      this.adapter.subscription,
      ...(this.stationHealth ? [this.stationHealth.subscription] : []),
    ];
  }

  onApplicationBootstrap(): void {
    if (!this.config.get('MQTT_INGESTION_ENABLED', { infer: true })) {
      this.logger.log('MQTT ingestion is disabled (MQTT_INGESTION_ENABLED=false)');
      return;
    }
    const url = this.config.get('MQTT_BROKER_URL', { infer: true });
    const client = connect(url, {
      clientId: this.config.get('MQTT_CLIENT_ID_BACKEND', { infer: true }),
      clean: false,
      username: this.config.get('MQTT_USERNAME', { infer: true }),
      password: this.config.get('MQTT_PASSWORD', { infer: true }),
      reconnectPeriod: 5_000,
    });
    client.handleMessage = (packet, done) => {
      this.handle(packet.topic, packet.payload as Buffer).then(
        () => done(),
        (error: unknown) => done(error as Error),
      );
    };
    client.on('connect', () => {
      this.state?.set(true);
      this.logger.log(`Connected to ${url}; subscribing to ${this.subscriptions.join(', ')}`);
      client.subscribe(this.subscriptions, { qos: 1 }, (error) => {
        if (error) this.logger.error(`Subscribe failed: ${error.message}`);
      });
    });
    client.on('close', () => this.state?.set(false));
    client.on('offline', () => this.state?.set(false));
    client.on('error', (error) => this.logger.warn(`MQTT error: ${error.message}`));
    this.client = client;
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    await this.client?.endAsync();
    this.state?.set(false);
  }

  // Exposed for the unit test; the broker calls it through handleMessage.
  async handle(topic: string, body: Buffer): Promise<void> {
    const receivedAt = new Date();
    if (this.stationHealth?.matches(topic)) {
      const health = this.stationHealth;
      await this.withRetry(() => health.handle(topic, body, receivedAt));
      return;
    }
    const result = this.adapter.adapt(topic, body, receivedAt);
    if (result.kind === 'ignored') return;
    await this.withRetry(() =>
      result.kind === 'malformed'
        ? this.ingestion.rejectMalformed(
            result.ingress,
            result.uplinkKey,
            result.detail,
            result.raw,
          )
        : this.ingestion.ingest(result.envelope),
    );
  }

  // Retries while the database is unreachable, so the message is not acknowledged and lost. Any other
  // error is a defect: it is logged with the topic and the message is acknowledged, because retrying a
  // deterministic failure would stall the whole stream.
  private async withRetry(work: () => Promise<unknown>): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        await work();
        return;
      } catch (error) {
        if (!isTransientDatabaseError(error) || this.stopping) {
          this.logger.error(
            `Ingestion failed and the message is dropped: ${error instanceof Error ? error.stack : String(error)}`,
          );
          return;
        }
        this.logger.warn(`Database unreachable, retrying ingestion (attempt ${attempt + 1})`);
        await sleep(backoffMs(attempt));
      }
    }
  }
}
