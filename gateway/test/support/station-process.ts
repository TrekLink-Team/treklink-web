// A Field Station process for the crash test (gateway-sync task 5.1): it opens the queue file given as
// the first argument and flushes it to the broker given as the second, until the test kills it.
// Run with ts-node: node -r ts-node/register/transpile-only test/support/station-process.ts <db> <url>
import { GatewayMqttClient } from '../../src/mqtt/mqtt-client';
import { SQLitePriorityQueue } from '../../src/queue/priority-queue';

const [dbPath, brokerUrl] = process.argv.slice(2);
if (!dbPath || !brokerUrl) {
  process.stderr.write('usage: station-process <queue.db> <broker url>\n');
  process.exit(2);
}
const queue = new SQLitePriorityQueue(dbPath);
const client = new GatewayMqttClient(
  brokerUrl,
  queue,
  { username: '', secret: '' },
  { reconnectPeriodMs: 100 },
);
client.connect();
process.on('SIGTERM', () => {
  client.disconnect();
  queue.close();
  process.exit(0);
});
