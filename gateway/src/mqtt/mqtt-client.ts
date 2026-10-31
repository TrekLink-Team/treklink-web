import * as mqtt from 'mqtt';
import pino from 'pino';
import { SQLitePriorityQueue } from '../queue/priority-queue';
import { gatewayConfig } from '../config';
import { buildHealthReport, gatewayVersion, healthTopic } from './health-report';

const logger = pino({ name: 'GatewayMQTT' });

/** The station credential the client may present to the broker (gateway-sync design §4). */
export interface StationCredential {
  username: string;
  secret: string;
}

/**
 * The mqtt.js options of one connection. The Field Station username and secret go in only when both
 * are set; with either missing the client connects anonymously, as the open demo broker expects. The
 * protocol, `mqtt://` or `mqtts://`, comes from the broker URL itself.
 */
export function connectOptions(
  credential: StationCredential,
  clientId: string,
  reconnectPeriod: number,
): mqtt.IClientOptions {
  const options: mqtt.IClientOptions = { clientId, reconnectPeriod };
  if (credential.username !== '' && credential.secret !== '') {
    options.username = credential.username;
    options.password = credential.secret;
  }
  return options;
}

/** The broker URL without any user information, so a password in the URL never reaches the log. */
export function redactBrokerUrl(brokerUrl: string): string {
  try {
    const url = new URL(brokerUrl);
    if (url.username === '' && url.password === '') return brokerUrl;
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    return '<unparseable broker URL>';
  }
}

export class GatewayMqttClient {
  private client: mqtt.MqttClient | null = null;
  private isConnected = false;
  private flushing = false;
  private healthTimer: NodeJS.Timeout | null = null;
  /** Station clock, epoch ms, of the last publish the broker acknowledged. */
  private lastFlushAt: number | null = null;
  private readonly version = gatewayVersion();

  constructor(
    private brokerUrl: string = gatewayConfig.mqtt.brokerUrl,
    private queue: SQLitePriorityQueue,
    private credential: StationCredential = gatewayConfig.station,
    // The outage tests and harness shorten the reconnect period; the gateway itself always uses the
    // configured GATEWAY_MQTT_RECONNECT_PERIOD_MS.
    private readonly options: { reconnectPeriodMs?: number } = {},
  ) {}

  /** True while the broker connection is up. */
  public get connected(): boolean {
    return this.isConnected;
  }

  public connect(): void {
    const options = connectOptions(
      this.credential,
      `${gatewayConfig.mqtt.clientIdPrefix}-${Math.random().toString(16).substring(2, 8)}`,
      this.options.reconnectPeriodMs ?? gatewayConfig.mqtt.reconnectPeriodMs,
    );
    const as = options.username === undefined ? 'without credentials' : `as ${options.username}`;
    logger.info(`Connecting to MQTT broker at ${redactBrokerUrl(this.brokerUrl)} ${as}...`);
    const halfSet = (this.credential.username === '') !== (this.credential.secret === '');
    if (halfSet) {
      logger.warn('Only one of GATEWAY_FS_USERNAME and GATEWAY_FS_SECRET is set: connecting without credentials.');
    }
    this.client = mqtt.connect(this.brokerUrl, options);

    this.client.on('connect', () => {
      this.isConnected = true;
      logger.info('Connected to MQTT broker. Triggering queue flush...');
      // The first report shows the backlog the outage left, before the flush drains it.
      this.publishHealth();
      this.startHealthTimer();
      this.flushQueue();
    });

    this.client.on('close', () => {
      this.isConnected = false;
      this.stopHealthTimer();
      this.dropUnacknowledged();
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

  // NFR-REL-04, REQ-ERR-03. mqtt.js keeps a copy of every QoS 1 or 2 publish the broker has not yet
  // acknowledged and, on reconnect, resends those copies before it reports the connection up, so before
  // the flush below runs. A P2 or P3 batch in flight at the cut would then reach the broker ahead of the
  // P0 rows queued during the outage. On every close the station removes those copies instead
  // (`removeOutgoingMessage`, which answers each publish callback with an error): the rows were never
  // removed from SQLite, because a row leaves only on its PUBACK, so they go out again in tier order with
  // the next flush, their attempt counted. A health report in flight is dropped the same way; the next
  // connect sends a fresh one. A publish the broker received but whose PUBACK the cut lost is sent again
  // and reaches the backend twice, which the backend's eventId dedup absorbs (REQ-ERR-02).
  private dropUnacknowledged(): void {
    const client = this.client;
    if (!client) return;
    const inFlight = Object.keys(client.outgoing).map(Number);
    if (inFlight.length === 0) return;
    logger.warn(`Dropping ${inFlight.length} unacknowledged publishes; their rows stay queued for the next flush.`);
    for (const messageId of inFlight) client.removeOutgoingMessage(messageId);
  }

  // Publishes one batch in tier order and waits for every acknowledgement, then takes the next batch
  // until the queue is empty. One flush runs at a time, so a row is never published twice by two
  // overlapping flushes; a row whose publish failed stays queued for the next flush, its attempt counted.
  // A drained queue sends a health report, so the cloud sees the empty queue and the flush time at once.
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
      if (failed) return;
      if (this.queue.count() === 0) this.publishHealth();
      else this.flushQueue();
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
          this.lastFlushAt = Date.now();
        } else {
          failed = true;
          this.queue.markAttempt(item.id);
          logger.error(`Failed to publish event ${item.eventId}: ${err.message}`);
        }
        done();
      });
    }
  }

  // The Field Station health report (gateway-sync design §3, FR-EVT-13): depth per tier, the oldest
  // entry's attempts, the last flush and the version, on `<root>/fs/<username>/health`. Sent only while
  // connected and only when GATEWAY_FS_USERNAME names the station.
  public publishHealth(): void {
    const { username, mqttRoot } = gatewayConfig.station;
    if (!this.isConnected || !this.client || username === '') return;
    const report = buildHealthReport(this.queue, this.version, this.lastFlushAt);
    this.client.publish(healthTopic(mqttRoot, username), JSON.stringify(report), { qos: 1 }, (err) => {
      if (err) logger.warn(`Health report not sent: ${err.message}`);
    });
  }

  private startHealthTimer(): void {
    this.stopHealthTimer();
    if (gatewayConfig.station.username === '') {
      logger.info('GATEWAY_FS_USERNAME is not set: no Field Station health reports are sent.');
      return;
    }
    this.healthTimer = setInterval(() => this.publishHealth(), gatewayConfig.station.healthIntervalMs);
  }

  private stopHealthTimer(): void {
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = null;
  }

  public disconnect(): void {
    this.stopHealthTimer();
    if (this.client) {
      this.client.end();
    }
  }
}
