// Replay harness (gateway-sync task 4.2, TC-11). Publishes the MQTT fixtures of task 1.2 to a broker at
// QoS 1, as the devices would, so ingestion can be exercised end to end through a real Mosquitto.
//
//   npm run replay:mqtt -- position telemetry sos           publish three fixtures once
//   npm run replay:mqtt -- sos --times 10                   TC-11: the same packet ten times
//   npm run replay:mqtt -- trek --now --new-ids --interval 2000
//                                                           a live demo: fresh ids, timestamps from now
//
// --now        shift every timestamp so the latest message is now, keeping the offsets between messages
// --new-ids    give every published packet a fresh random id, so a repeated demo is not deduplicated
// --times N    publish the whole set N times (default 1)
// --interval   milliseconds between messages (default 0)
// Broker: MQTT_BROKER_URL, MQTT_USERNAME, MQTT_PASSWORD from the environment or .env, ../.env.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { connectAsync } from 'mqtt';

interface FixtureMessage {
  topic: string;
  message?: Record<string, unknown>;
  raw?: string;
}

const FIXTURES = join(__dirname, '..', 'fixtures', 'mqtt');

export const loadFixture = (name: string): FixtureMessage[] =>
  (
    JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')) as {
      messages: FixtureMessage[];
    }
  ).messages;

// Returns the payload to publish; `shiftSeconds` moves the rx_time and the position time, `newId` replaces
// the packet id. A raw (non-JSON) fixture is published unchanged.
export const prepare = (
  fixture: FixtureMessage,
  { shiftSeconds = 0, newId }: { shiftSeconds?: number; newId?: number },
): string => {
  if (fixture.raw !== undefined || !fixture.message) return fixture.raw ?? '';
  const message = structuredClone(fixture.message);
  if (typeof message.timestamp === 'number' && message.timestamp > 0)
    message.timestamp += shiftSeconds;
  const payload = message.payload as Record<string, unknown> | undefined;
  if (payload && typeof payload.time === 'number' && payload.time > 0) payload.time += shiftSeconds;
  if (newId !== undefined) message.id = newId;
  return JSON.stringify(message);
};

const option = (args: string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

async function main() {
  for (const file of ['.env', '../.env']) if (existsSync(file)) process.loadEnvFile(file);
  const args = process.argv.slice(2);
  const valued = new Set(['--times', '--interval']);
  const names = args.filter((arg, i) => !arg.startsWith('--') && !valued.has(args[i - 1]));
  if (names.length === 0) throw new Error('name at least one fixture, e.g. position sos trek');
  const times = Number(option(args, '--times') ?? 1);
  const interval = Number(option(args, '--interval') ?? 0);
  const fixtures = names.flatMap(loadFixture);

  // --now anchors the latest timestamp at now, so every message stays in the past: a device time more
  // than gatewaySync.deviceTimeMaxAheadSeconds ahead would fall back to receipt time (REQ-UBI-06).
  const latestTimestamp = Math.max(
    0,
    ...fixtures.map((f) => (typeof f.message?.timestamp === 'number' ? f.message.timestamp : 0)),
  );
  const shiftSeconds =
    args.includes('--now') && latestTimestamp > 0
      ? Math.floor(Date.now() / 1000) - latestTimestamp
      : 0;

  const url = process.env.MQTT_BROKER_URL ?? 'mqtt://localhost:1883';
  const client = await connectAsync(url, {
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD,
    clientId: `treklink-replay-${process.pid}`,
  });
  let published = 0;
  try {
    for (let round = 0; round < times; round++) {
      for (const fixture of fixtures) {
        const newId = args.includes('--new-ids')
          ? Math.floor(Math.random() * 0xffffffff)
          : undefined;
        await client.publishAsync(fixture.topic, prepare(fixture, { shiftSeconds, newId }), {
          qos: 1,
        });
        published++;
        if (interval > 0) await new Promise((resolve) => setTimeout(resolve, interval));
      }
    }
  } finally {
    await client.endAsync();
  }
  console.log(
    `Replayed ${published} message(s) to ${url} (${names.join(', ')}, ${times} round(s)).`,
  );
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(`Replay failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
