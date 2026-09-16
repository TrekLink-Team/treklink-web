/**
 * Gateway configuration (D-015).
 *
 * No business or operational parameter is a literal anywhere else in the gateway. Every value that
 * a stakeholder could reasonably want changed without a code deploy is resolved here and registered
 * in the Configuration Matrix, with a demo path.
 *
 * The faculty fault handbook ranks hardcoded parameters the #2 cause of project failure, and the
 * first question on its most-asked list is "can this number be changed? show me now." Anything here
 * must be changeable via environment variable and demonstrable live.
 */

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) throw new Error(`Environment variable ${name} is not a number: ${raw}`);
  return parsed;
}

function str(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : raw;
}

/** Priority tiers. Lower value flushes first — P0 SOS must never queue behind telemetry. */
export enum PriorityTier {
  P0_SOS = 0,
  P1_LOCATION = 1,
  P2_GPS = 2,
  P3_TELEMETRY = 3,
}

export const gatewayConfig = {
  queue: {
    dbPath: str('GATEWAY_SQLITE_DB_PATH', './gateway_queue.db'),
    /** Rows read per peek when inspecting the queue. */
    peekLimit: num('GATEWAY_QUEUE_PEEK_LIMIT', 10),
    /** Rows published per flush cycle on reconnect. Larger drains faster, risks broker backpressure. */
    flushBatchSize: num('GATEWAY_QUEUE_FLUSH_BATCH_SIZE', 20),
    /**
     * Maximum rows retained during an outage. On overflow the lowest-priority tier is shed first
     * and P0 is never shed (exception scenario E02-5). 0 disables shedding.
     */
    maxSize: num('GATEWAY_QUEUE_MAX_SIZE', 100_000),
    /** Lowest tier eligible for shedding. Must stay above P0_SOS. */
    shedFromTier: num('GATEWAY_QUEUE_SHED_FROM_TIER', PriorityTier.P3_TELEMETRY),
  },

  mqtt: {
    brokerUrl: str('MQTT_BROKER_URL', 'mqtt://localhost:1883'),
    clientIdPrefix: str('MQTT_CLIENT_ID_GATEWAY', 'treklink-gateway'),
    /** Topic prefix; the priority tier is appended as the final segment. */
    topicPrefix: str('GATEWAY_MQTT_TOPIC_PREFIX', 'treklink/events/priority'),
    /** Milliseconds between reconnect attempts when the uplink is down. */
    reconnectPeriodMs: num('GATEWAY_MQTT_RECONNECT_PERIOD_MS', 3_000),
    /** QoS for published events. 1 = at-least-once; dedup is handled backend-side by eventId. */
    qos: num('GATEWAY_MQTT_QOS', 1) as 0 | 1 | 2,
  },

  serial: {
    port: str('GATEWAY_SERIAL_PORT', '/dev/ttyUSB0'),
    baudRate: num('GATEWAY_SERIAL_BAUD', 115_200),
    simulationMode: process.env.GATEWAY_SERIAL_SIMULATION !== 'false',
  },
} as const;

export type GatewayConfig = typeof gatewayConfig;
