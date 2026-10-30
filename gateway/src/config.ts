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
 *
 * This module loads the environment itself rather than relying on its importer to have done so
 * first. Values are read at module scope, so an import-order dependency here is a silent failure
 * mode: the config would resolve to defaults with no error.
 */
import dotenv from 'dotenv';

dotenv.config({ path: ['.env', '../.env'] });

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
    /**
     * Stage B (D-005): the bridge republishes each node's packet on that node's own uplink topic,
     * `<prefix>/<channel>/<sender>`, the topic the backend ingests (gateway-sync design §4).
     */
    topicPrefix: str('GATEWAY_MQTT_TOPIC_PREFIX', 'treklink/2/json'),
    /** The channel name in the topic; the backend does not read it. */
    channelName: str('GATEWAY_MQTT_CHANNEL', 'LongFast'),
    /** Milliseconds between reconnect attempts when the uplink is down. */
    reconnectPeriodMs: num('GATEWAY_MQTT_RECONNECT_PERIOD_MS', 3_000),
    /** QoS for published events. 1 = at-least-once; dedup is handled backend-side by eventId. */
    qos: num('GATEWAY_MQTT_QOS', 1) as 0 | 1 | 2,
  },

  /**
   * The Field Station identity and its health report (gateway-sync design §3, FR-EVT-13). The report goes
   * to `<root>/fs/<username>/health`; with no username the station sends none.
   */
  station: {
    username: str('GATEWAY_FS_USERNAME', ''),
    /** The topic root, `MQTT_ROOT` on the backend. */
    mqttRoot: str('GATEWAY_MQTT_ROOT', 'treklink'),
    /** Milliseconds between health reports while connected; the design's cadence is 60 s. */
    healthIntervalMs: num('GATEWAY_HEALTH_INTERVAL_MS', 60_000),
  },

  serial: {
    port: str('GATEWAY_SERIAL_PORT', '/dev/ttyUSB0'),
    baudRate: num('GATEWAY_SERIAL_BAUD', 115_200),
    simulationMode: process.env.GATEWAY_SERIAL_SIMULATION !== 'false',
  },

  /** Simulation mode only: what the simulated nodes send, for demos without hardware. */
  simulation: {
    /** Node ids to simulate; the defaults are TL-0009 and TL-0010 of the demo seed. */
    nodes: str('GATEWAY_SIM_NODES', '!de000009,!de00000a')
      .split(',')
      .map((node) => node.trim())
      .filter((node) => node !== ''),
    /** Milliseconds between ticks; each tick sends a position and a telemetry reading per node. */
    intervalMs: num('GATEWAY_SIM_INTERVAL_MS', 5_000),
    /** Every n-th tick the first node sends an SOS; 0 never. */
    sosEvery: num('GATEWAY_SIM_SOS_EVERY', 12),
    /** Where the walk starts (Ta Nang, the fixtures' area). */
    startLat: num('GATEWAY_SIM_START_LAT', 11.5544),
    startLon: num('GATEWAY_SIM_START_LON', 108.5381),
  },
} as const;

export type GatewayConfig = typeof gatewayConfig;
