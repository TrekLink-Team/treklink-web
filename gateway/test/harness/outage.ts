// Field Station outage harness (gateway-sync task 5.3, RQ1). Runs a simulated Field Station (the
// gateway's own simulator, SQLite queue and MQTT client) against a local broker, cuts its uplink for a
// given time, restores it, and reports delivery rate, delivery latency and P0-before-P2/P3 ordering
// against NFR-REL-01, NFR-REL-02 and NFR-REL-04. How to run it: test/harness/README.md.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { gatewayConfig } from '../../src/config';
import { GatewayMqttClient } from '../../src/mqtt/mqtt-client';
import { SQLitePriorityQueue } from '../../src/queue/priority-queue';
import { FrameSimulator, StockPacket, tierOf } from '../../src/serial/simulator';
import { subscribe, TestBroker, waitFor } from '../support/broker';
import { UplinkProxy } from '../support/uplink';
import { ConditionVerdict, EventRecord, judge, summarize, TrialSummary } from './outage-metrics';

export interface HarnessOptions {
  /** Outage lengths to test, seconds; each is one condition. */
  outagesS: number[];
  trials: number;
  /** Seconds of uplink-up traffic before the cut and after the backlog drained. */
  warmupS: number;
  tailS: number;
  /** Simulator tick; each tick every node sends a position and a telemetry reading. */
  intervalMs: number;
  nodes: number;
  /** Every n-th tick the first node sends an SOS. */
  sosEvery: number;
  /** The station's MQTT reconnect period; defaults to GATEWAY_MQTT_RECONNECT_PERIOD_MS. */
  reconnectMs: number;
  /** Longest wait for the backlog, and for the last event, before a trial gives up on them. */
  drainTimeoutS: number;
  /** An external broker (for example a local Mosquitto); the in-process aedes broker otherwise. */
  brokerUrl?: string;
  /** Rows the queue keeps (GATEWAY_QUEUE_MAX_ROWS). */
  maxRows: number;
  minTrials: number;
  log: (line: string) => void;
}

export interface HarnessReport {
  options: Omit<HarnessOptions, 'log'>;
  conditions: { verdict: ConditionVerdict; trials: TrialSummary[]; shed: number[] }[];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const keyOf = (packet: { from?: unknown; id?: unknown }) => `${String(packet.from)}:${String(packet.id)}`;
const nodeIds = (count: number) =>
  Array.from({ length: count }, (_, n) => `!de${(0x9 + n).toString(16).padStart(6, '0')}`);

async function runTrial(
  options: HarnessOptions,
  outageS: number,
  brokerHost: string,
  brokerPort: number,
  brokerUrl: string,
): Promise<{ summary: TrialSummary; shed: number[] }> {
  const root = mkdtempSync(join(tmpdir(), 'gateway-harness-'));
  const uplink = new UplinkProxy(brokerHost, brokerPort);
  await uplink.start();
  const backend = await subscribe(brokerUrl, `${gatewayConfig.mqtt.topicPrefix}/#`);
  const queue = new SQLitePriorityQueue(join(root, 'queue.db'), {
    maxRows: options.maxRows,
    logger: { warn: () => undefined, error: (line) => options.log(`  queue: ${line}`) },
  });
  const station = new GatewayMqttClient(uplink.url, queue, { reconnectPeriodMs: options.reconnectMs });
  const events = new Map<string, EventRecord>();
  let arrivals = 0;
  let duplicates = 0;
  let foreign = 0;
  backend.client.on('message', (_topic, payload) => {
    let key: string;
    try {
      key = keyOf(JSON.parse(payload.toString()) as StockPacket);
    } catch {
      foreign += 1;
      return;
    }
    const event = events.get(key);
    if (!event) foreign += 1;
    else if (event.receivedAt !== undefined) duplicates += 1;
    else {
      event.receivedAt = Date.now();
      event.arrival = arrivals++;
    }
  });

  // The serial side: the gateway simulator's packets go through the queue exactly as SerialFrameReader
  // hands them over, enqueue then flush.
  const simulator = new FrameSimulator({
    nodes: nodeIds(options.nodes),
    intervalMs: options.intervalMs,
    sosEvery: options.sosEvery,
    startLat: gatewayConfig.simulation.startLat,
    startLon: gatewayConfig.simulation.startLon,
  });
  const generator = setInterval(() => {
    for (const packet of simulator.next()) {
      const tier = tierOf(packet);
      events.set(keyOf(packet), { key: keyOf(packet), tier, generatedAt: Date.now() });
      queue.enqueue(`${packet.sender}:${packet.from}:${packet.id}`, tier, packet);
      station.flushQueue();
    }
  }, options.intervalMs);

  try {
    station.connect();
    await waitFor(() => station.connected, 10_000, 'the station to connect');
    // An outage starts at an arbitrary moment: a random offset inside one tick keeps the cut from
    // always landing just after the simulator's tick.
    await sleep(options.warmupS * 1000 + Math.random() * options.intervalMs);

    const cutAt = Date.now();
    uplink.cut();
    await sleep(outageS * 1000);
    const restoreAt = Date.now();
    uplink.restore();

    const backlog = () =>
      [...events.values()].filter(
        (event) => event.generatedAt < restoreAt && (event.receivedAt === undefined || event.receivedAt >= restoreAt),
      );
    let backlogDrainedAt: number | undefined;
    try {
      await waitFor(() => backlog().every((event) => event.receivedAt !== undefined), options.drainTimeoutS * 1000, 'the backlog');
      backlogDrainedAt = Math.max(restoreAt, ...backlog().map((event) => event.receivedAt as number));
    } catch {
      options.log(`  backlog not drained within ${options.drainTimeoutS} s`);
    }

    await sleep(options.tailS * 1000);
    clearInterval(generator);
    try {
      await waitFor(() => [...events.values()].every((event) => event.receivedAt !== undefined), options.drainTimeoutS * 1000, 'the last events');
    } catch {
      options.log(`  ${[...events.values()].filter((event) => event.receivedAt === undefined).length} events never arrived`);
    }
    if (foreign > 0) options.log(`  ${foreign} messages on the uplink topic were not this trial's`);
    return {
      summary: summarize([...events.values()], { cutAt, restoreAt, backlogDrainedAt }, duplicates),
      shed: queue.shedByTier(),
    };
  } finally {
    clearInterval(generator);
    station.disconnect();
    await backend.client.endAsync();
    await uplink.stop();
    queue.close();
    rmSync(root, { recursive: true, force: true });
  }
}

const pct = (rate: number | null) => (rate === null ? 'n/a' : `${(rate * 100).toFixed(2)} %`);
const ms = (value: number | null) => (value === null ? 'n/a' : Number.isFinite(value) ? `${value} ms` : 'lost');

// The options as recorded in the JSON report: everything but the log sink.
const settingsOf = ({ log, ...settings }: HarnessOptions): HarnessReport['options'] => {
  void log;
  return settings;
};

export async function runHarness(options: HarnessOptions): Promise<HarnessReport> {
  let broker: TestBroker | null = null;
  let host = '127.0.0.1';
  let port: number;
  let url: string;
  if (options.brokerUrl) {
    const parsed = new URL(options.brokerUrl);
    host = parsed.hostname;
    port = Number(parsed.port || 1883);
    url = options.brokerUrl;
  } else {
    broker = new TestBroker();
    await broker.start();
    port = broker.port;
    url = broker.url;
  }
  const report: HarnessReport = { options: settingsOf(options), conditions: [] };
  try {
    for (const outageS of options.outagesS) {
      const trials: TrialSummary[] = [];
      const shed = [0, 0, 0, 0];
      for (let trial = 1; trial <= options.trials; trial += 1) {
        const result = await runTrial(options, outageS, host, port, url);
        trials.push(result.summary);
        result.shed.forEach((count, tier) => (shed[tier] += count));
        const s = result.summary;
        options.log(
          `outage ${outageS} s, trial ${trial}/${options.trials}: ` +
            `outage events ${s.outageDelivered}/${s.outageGenerated} delivered (${pct(s.deliveryRate)}), ` +
            `backlog P0 first ${s.backlogP0BeforeLow}/${s.backlogP0} (${pct(s.orderingRate)}` +
            (s.lowAheadOfP0 > 0 ? `, ${s.lowAheadOfP0} P2/P3 ahead, ${s.lowAheadOfP0InFlight} in flight at the cut` : '') +
            `), ` +
            `steady latency p50 ${ms(s.steadyLatency.p50)} p95 ${ms(s.steadyLatency.p95)} max ${ms(s.steadyLatency.max)} (n=${s.steadyLatency.count}), ` +
            `drain ${ms(s.drainMs)}, duplicates ${s.duplicates}`,
        );
      }
      const verdict = judge(trials, options.minTrials);
      report.conditions.push({ verdict, trials, shed });
    }
  } finally {
    if (broker) await broker.stop();
  }
  options.log('');
  options.log('| Outage | Trials | NFR-REL-02 delivery (pooled, worst trial) | NFR-REL-04 P0 first | NFR-REL-01 latency p95, max | Shed P2, P3 |');
  options.log('|---|---|---|---|---|---|');
  for (const { verdict: v, shed } of report.conditions) {
    const mark = (pass: boolean) => (pass ? 'pass' : 'FAIL');
    options.log(
      `| ${v.outageMs >= 60_000 ? `${(v.outageMs / 60_000).toFixed(1)} min` : `${(v.outageMs / 1000).toFixed(1)} s`} ` +
        `| ${v.trials}${v.enoughTrials ? '' : ` (under ${options.minTrials}, indicative)`} ` +
        `| ${pct(v.deliveryRate)}, ${pct(v.minTrialDeliveryRate)}: ${mark(v.nfrRel02)} ` +
        `| ${pct(v.orderingRate)}: ${mark(v.nfrRel04)} ` +
        `| ${ms(v.latencyP95)}, ${ms(v.latencyMax)}: ${mark(v.nfrRel01)} ` +
        `| ${shed[2]}, ${shed[3]} |`,
    );
  }
  return report;
}

function parseOptions(argv: string[]): HarnessOptions & { json?: string } {
  const { values } = parseArgs({
    args: argv,
    options: {
      outage: { type: 'string', default: '30,120' },
      trials: { type: 'string', default: '20' },
      warmup: { type: 'string', default: '10' },
      tail: { type: 'string', default: '10' },
      'interval-ms': { type: 'string', default: '1000' },
      nodes: { type: 'string', default: '2' },
      'sos-every': { type: 'string', default: '3' },
      'reconnect-ms': { type: 'string', default: String(gatewayConfig.mqtt.reconnectPeriodMs) },
      'drain-timeout': { type: 'string', default: '120' },
      'max-rows': { type: 'string', default: String(gatewayConfig.queue.maxRows) },
      'min-trials': { type: 'string', default: '20' },
      broker: { type: 'string' },
      json: { type: 'string' },
    },
  });
  const number = (name: keyof typeof values, min: number) => {
    const value = Number(values[name]);
    if (!Number.isFinite(value) || value < min) throw new Error(`--${String(name)} must be a number of at least ${min}`);
    return value;
  };
  const outagesS = String(values.outage)
    .split(',')
    .map((part) => Number(part.trim()));
  if (outagesS.some((value) => !Number.isFinite(value) || value <= 0)) throw new Error('--outage takes seconds, for example 30,120');
  return {
    outagesS,
    trials: number('trials', 1),
    warmupS: number('warmup', 0),
    tailS: number('tail', 1),
    intervalMs: number('interval-ms', 50),
    nodes: number('nodes', 1),
    sosEvery: number('sos-every', 1),
    reconnectMs: number('reconnect-ms', 50),
    drainTimeoutS: number('drain-timeout', 1),
    maxRows: number('max-rows', 1),
    minTrials: number('min-trials', 1),
    brokerUrl: values.broker,
    json: values.json,
    // Stderr, so the gateway's own JSON log lines on stdout can be dropped with >/dev/null.
    log: (line: string) => process.stderr.write(`${line}\n`),
  };
}

if (require.main === module) {
  const { json, ...options } = parseOptions(process.argv.slice(2));
  runHarness(options)
    .then((report) => {
      if (json) writeFileSync(json, JSON.stringify(report, null, 2));
      process.exit(0);
    })
    .catch((err: Error) => {
      process.stderr.write(`outage harness failed: ${err.message}\n`);
      process.exit(1);
    });
}
