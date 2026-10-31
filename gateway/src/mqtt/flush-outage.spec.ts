import { ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { subscribe, TestBroker, waitFor } from '../../test/support/broker';
import { UplinkProxy } from '../../test/support/uplink';
import { PriorityTier, SQLitePriorityQueue } from '../queue/priority-queue';
import { GatewayMqttClient } from './mqtt-client';

const { P0_SOS, P1_LOCATION, P2_GPS, P3_TELEMETRY } = PriorityTier;
const UPLINK = 'treklink/2/json/#';
const silent = { warn: () => undefined, error: () => undefined };

// A stock-shaped packet whose `id` names its queue event, so a received message maps back to its row.
const packet = (n: number, tier: PriorityTier) => {
  const sender = n % 2 === 0 ? '!de000009' : '!de00000a';
  const type = tier === P0_SOS ? 'text' : tier === P3_TELEMETRY ? 'telemetry' : 'position';
  const payload = tier === P0_SOS ? { text: 'SOS - [11.554400], [108.538100]' } : { battery_level: 90 };
  return { id: n, from: Number.parseInt(sender.slice(1), 16), sender, type, payload, timestamp: 1_761_900_000 + n };
};

// 200 events across the four tiers in a mixed arrival order: 20 P0, 20 P1, 80 P2, 80 P3.
const mixedTiers = (count: number): PriorityTier[] =>
  Array.from({ length: count }, (_, n) => [P3_TELEMETRY, P2_GPS, P3_TELEMETRY, P2_GPS, P0_SOS, P3_TELEMETRY, P2_GPS, P1_LOCATION, P3_TELEMETRY, P2_GPS][n % 10]);

const idOf = (payload: string) => (JSON.parse(payload) as { id: number }).id;

describe('Field Station flush across an outage (gateway-sync task 5.1)', () => {
  let root: string;
  const cleanups: (() => Promise<void> | void)[] = [];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'gateway-outage-'));
  });

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    rmSync(root, { recursive: true, force: true });
  });

  // AC-03 (TC-12, NFR-REL-04): events queued while the broker is down flush P0 first on reconnect.
  it('AC-03: 200 events queued with the broker down arrive with every P0 before any P2 or P3', async () => {
    const broker = new TestBroker();
    await broker.start();
    await broker.stop(); // the port is known and nothing listens on it: the uplink is down

    const queue = new SQLitePriorityQueue(join(root, 'queue.db'), { logger: silent });
    cleanups.push(() => queue.close());
    const tiers = mixedTiers(200);
    tiers.forEach((tier, n) => queue.enqueue(`ev-${n}`, tier, packet(n, tier)));
    expect(queue.depthByTier()).toEqual([20, 20, 80, 80]);

    const station = new GatewayMqttClient(
      broker.url,
      queue,
      { username: '', secret: '' },
      { reconnectPeriodMs: 50 },
    );
    station.connect();
    cleanups.push(() => station.disconnect());
    await new Promise((resolve) => setTimeout(resolve, 300)); // several refused reconnects
    expect(station.connected).toBe(false);
    expect(queue.count()).toBe(200);

    await broker.start();
    cleanups.push(() => broker.stop());
    const backend = await subscribe(broker.url, UPLINK);
    cleanups.push(() => backend.client.endAsync());
    await waitFor(() => backend.received.length >= 200 && queue.count() === 0, 15_000, '200 deliveries');

    const arrived = backend.received.map((message) => tiers[idOf(message.payload)]);
    expect(new Set(backend.received.map((message) => idOf(message.payload))).size).toBe(200);
    const lastP0 = arrived.lastIndexOf(P0_SOS);
    const firstLow = arrived.findIndex((tier) => tier === P2_GPS || tier === P3_TELEMETRY);
    expect(lastP0).toBeLessThan(firstLow);
    // The whole flush is in tier order, P1 included.
    expect(arrived).toEqual([...arrived].sort((a, b) => a - b));
  }, 30_000);

  // REQ-ERR-03, REQ-ERR-04: a station killed mid-flush loses nothing and has removed only rows whose
  // publish the broker acknowledged; after the restart it delivers the rest.
  it('kill mid-flush and restart: nothing lost, nothing removed without a PUBACK', async () => {
    const dbPath = join(root, 'queue.db');
    const seed = new SQLitePriorityQueue(dbPath, { logger: silent });
    const tiers = mixedTiers(120);
    tiers.forEach((tier, n) => seed.enqueue(`ev-${n}`, tier, packet(n, tier)));
    seed.close();

    // The broker acknowledges the first 30 uplink publishes and holds every later PUBACK, so the
    // second batch of 20 is half acknowledged when the station dies.
    const acked = new Set<number>();
    const held = new Set<number>();
    let holdAfter = 30;
    const broker = new TestBroker(0, (_client, message, callback) => {
      if (!message.topic.startsWith('treklink/2/json/')) return callback(null);
      const id = idOf(message.payload.toString());
      if (acked.size < holdAfter) {
        acked.add(id);
        return callback(null);
      }
      held.add(id); // no callback: no PUBACK
    });
    await broker.start();
    cleanups.push(() => broker.stop());
    const backend = await subscribe(broker.url, UPLINK);
    cleanups.push(() => backend.client.endAsync());

    const station = startStation(dbPath, broker.url);
    cleanups.push(() => stopStation(station));
    await waitFor(() => acked.size >= 30 && held.size >= 1, 20_000, 'a half-acknowledged batch');
    await new Promise((resolve) => setTimeout(resolve, 300)); // the station handles the PUBACKs it got
    await stopStation(station, 'SIGKILL');

    const rows = new Database(dbPath, { readonly: true });
    const remaining = new Set(
      (rows.prepare('SELECT event_id as eventId FROM event_queue').all() as { eventId: string }[]).map((row) =>
        Number(row.eventId.slice(3)),
      ),
    );
    rows.close();
    const removed = tiers.map((_, n) => n).filter((n) => !remaining.has(n));
    // Nothing marked flushed without a PUBACK: every removed row was acknowledged by the broker.
    for (const n of removed) expect(acked.has(n)).toBe(true);
    // Nothing lost: every row is either still queued or was accepted by the broker.
    for (let n = 0; n < tiers.length; n += 1) expect(remaining.has(n) || acked.has(n)).toBe(true);
    // The kill landed mid-flush: some rows were already removed on their PUBACK, some publishes were held.
    expect(removed.length).toBeGreaterThan(0);
    expect(held.size).toBeGreaterThan(0);
    for (const n of held) expect(remaining.has(n)).toBe(true);

    // Restart against a broker that acknowledges everything: the rest is delivered and the queue drains.
    holdAfter = Number.POSITIVE_INFINITY;
    const restarted = startStation(dbPath, broker.url);
    cleanups.push(() => stopStation(restarted));
    const delivered = () => new Set(backend.received.map((message) => idOf(message.payload)));
    await waitFor(() => delivered().size === tiers.length, 20_000, 'every event delivered after the restart');
    const after = new Database(dbPath, { readonly: true });
    await waitFor(
      () => (after.prepare('SELECT count(*) as count FROM event_queue').get() as { count: number }).count === 0,
      10_000,
      'the queue to drain',
    );
    after.close();
  }, 60_000);

  // NFR-REL-04, REQ-ERR-03: the link drops while a batch of P3 rows waits for its PUBACKs, and P0 rows
  // queue during the outage. mqtt.js keeps its own copy of every unacknowledged QoS 1 publish and, left
  // alone, resends those copies on reconnect before the queue's flush runs, so the P3 rows reach the
  // backend ahead of the outage's P0. The station drops those copies on disconnect: the rows stay queued
  // and go out again in tier order, P0 first.
  it('link cut mid-batch: the unacknowledged rows go out again in tier order, after the outage P0', async () => {
    let hold = true;
    const held: string[] = [];
    const broker = new TestBroker(0, (_client, message, callback) => {
      if (!message.topic.startsWith('treklink/2/json/')) return callback(null);
      if (hold) {
        held.push(message.payload.toString()); // no callback: no PUBACK, and nothing reaches a subscriber
        return;
      }
      callback(null);
    });
    await broker.start();
    cleanups.push(() => broker.stop());
    const uplink = new UplinkProxy('127.0.0.1', broker.port);
    await uplink.start();
    cleanups.push(() => uplink.stop());
    const backend = await subscribe(broker.url, UPLINK);
    cleanups.push(() => backend.client.endAsync());

    const queue = new SQLitePriorityQueue(join(root, 'queue.db'), { logger: silent });
    cleanups.push(() => queue.close());
    const tierOf = new Map<number, PriorityTier>();
    const add = (n: number, tier: PriorityTier) => {
      tierOf.set(n, tier);
      queue.enqueue(`ev-${n}`, tier, packet(n, tier));
    };
    [0, 1, 2].forEach((n) => add(n, P3_TELEMETRY));
    add(3, P2_GPS);

    const station = new GatewayMqttClient(uplink.url, queue, { username: '', secret: '' }, { reconnectPeriodMs: 50 });
    station.connect();
    cleanups.push(() => station.disconnect());
    await waitFor(() => held.length === 4, 5_000, 'the first batch in flight');

    uplink.cut();
    await waitFor(() => !station.connected, 5_000, 'the station to see the link down');
    // Nothing the broker did not acknowledge has left the queue.
    expect(queue.count()).toBe(4);
    [10, 11].forEach((n) => add(n, P0_SOS));
    add(12, P1_LOCATION);
    await new Promise((resolve) => setTimeout(resolve, 200)); // refused reconnects while the link is down

    hold = false;
    uplink.restore();
    await waitFor(() => queue.count() === 0, 10_000, 'the queue to drain');
    await waitFor(() => backend.received.length >= 7, 5_000, 'every event at the backend');
    await new Promise((resolve) => setTimeout(resolve, 200)); // a late duplicate would arrive by now

    const arrived = backend.received.map((message) => tierOf.get(idOf(message.payload)));
    expect(new Set(backend.received.map((message) => idOf(message.payload)))).toEqual(new Set(tierOf.keys()));
    expect(arrived).toEqual([P0_SOS, P0_SOS, P1_LOCATION, P2_GPS, P3_TELEMETRY, P3_TELEMETRY, P3_TELEMETRY]);
  }, 30_000);

  // A row whose PUBACK is pending can be shed by the bound (priority-queue.ts, `shedByTier()`). The shed
  // log and the count report it shed in both cases below; only in the second is the event really lost.
  describe('a shed of a row whose PUBACK is pending', () => {
    const setup = async () => {
      let hold = true;
      const held: (() => void)[] = [];
      const broker = new TestBroker(0, (_client, message, callback) => {
        if (!message.topic.startsWith('treklink/2/json/') || !hold) return callback(null);
        held.push(() => callback(null));
      });
      await broker.start();
      cleanups.push(() => broker.stop());
      const uplink = new UplinkProxy('127.0.0.1', broker.port);
      await uplink.start();
      cleanups.push(() => uplink.stop());
      const backend = await subscribe(broker.url, UPLINK);
      cleanups.push(() => backend.client.endAsync());

      const logger = { warn: jest.fn(), error: jest.fn() };
      const queue = new SQLitePriorityQueue(join(root, 'queue.db'), { maxRows: 2, logger });
      cleanups.push(() => queue.close());
      queue.enqueue('ev-0', P3_TELEMETRY, packet(0, P3_TELEMETRY));
      const station = new GatewayMqttClient(uplink.url, queue, { username: '', secret: '' }, { reconnectPeriodMs: 50 });
      station.connect();
      cleanups.push(() => station.disconnect());
      await waitFor(() => held.length === 1, 5_000, 'ev-0 in flight');

      // Two P0 rows take the queue past its bound of 2: the bound sheds ev-0, still in flight.
      queue.enqueue('ev-10', P0_SOS, packet(10, P0_SOS));
      const result = queue.enqueue('ev-12', P0_SOS, packet(12, P0_SOS));
      expect(result.shed).toEqual([expect.objectContaining({ eventId: 'ev-0', priority: P3_TELEMETRY })]);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('shed P3 row 1 (event ev-0)'));
      expect(queue.shedByTier()).toEqual([0, 0, 0, 1]);
      const delivered = () => new Set(backend.received.map((message) => idOf(message.payload)));
      return { queue, station, uplink, held, delivered, release: () => (hold = false) };
    };

    it('connection holds: the PUBACK arrives, the event reaches the backend and still counts as shed', async () => {
      const { queue, held, delivered, release } = await setup();
      release();
      held.forEach((acknowledge) => acknowledge());
      await waitFor(() => queue.count() === 0, 5_000, 'the P0 rows to flush');
      await waitFor(() => delivered().size === 3, 5_000, 'three deliveries');
      expect(delivered()).toEqual(new Set([0, 10, 12]));
      expect(queue.shedByTier()).toEqual([0, 0, 0, 1]);
    }, 30_000);

    it('connection drops first: the client drops its copy, the event is lost as counted', async () => {
      const { queue, station, uplink, delivered, release } = await setup();
      uplink.cut();
      await waitFor(() => !station.connected, 5_000, 'the station to see the link down');
      release();
      uplink.restore();
      await waitFor(() => queue.count() === 0, 10_000, 'the P0 rows to flush');
      await waitFor(() => delivered().size >= 2, 5_000, 'two deliveries');
      await new Promise((resolve) => setTimeout(resolve, 300)); // a resent ev-0 would arrive by now
      expect(delivered()).toEqual(new Set([10, 12]));
      expect(queue.shedByTier()).toEqual([0, 0, 0, 1]);
    }, 30_000);
  });
});

function startStation(dbPath: string, url: string): ChildProcess {
  const child = spawn(
    process.execPath,
    ['-r', 'ts-node/register/transpile-only', join(__dirname, '..', '..', 'test', 'support', 'station-process.ts'), dbPath, url],
    {
      cwd: join(__dirname, '..', '..'),
      env: { ...process.env, TS_NODE_PROJECT: join(__dirname, '..', '..', 'test', 'tsconfig.json'), GATEWAY_FS_USERNAME: '' },
      stdio: 'ignore',
    },
  );
  return child;
}

async function stopStation(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.kill(signal);
  });
}
