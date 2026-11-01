import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PriorityTier, SQLitePriorityQueue } from './priority-queue';

describe('SQLitePriorityQueue', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'gateway-queue-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('creates the folder of its database file on a fresh clone', () => {
    const dbPath = join(root, 'data', 'nested', 'gateway_queue.db');
    expect(existsSync(join(root, 'data'))).toBe(false);
    const queue = new SQLitePriorityQueue(dbPath);
    expect(existsSync(dbPath)).toBe(true);
    queue.close();
  });

  it('opens an in-memory database without touching the file system', () => {
    const queue = new SQLitePriorityQueue(':memory:');
    expect(existsSync(':memory:')).toBe(false);
    queue.close();
  });

  it('reports the depth per tier and the oldest entry\'s attempts for the health report', () => {
    const queue = new SQLitePriorityQueue(':memory:');
    expect(queue.depthByTier()).toEqual([0, 0, 0, 0]);
    expect(queue.oldestAttempts()).toBeNull();
    queue.enqueue('a', PriorityTier.P3_TELEMETRY, { sender: '!de000009' });
    queue.enqueue('b', PriorityTier.P0_SOS, { sender: '!de000009' });
    queue.enqueue('c', PriorityTier.P2_GPS, { sender: '!de000009' });
    queue.enqueue('d', PriorityTier.P3_TELEMETRY, { sender: '!de00000a' });
    expect(queue.depthByTier()).toEqual([1, 0, 1, 2]);
    const oldest = queue.peek(10).find((item) => item.eventId === 'a')!;
    queue.markAttempt(oldest.id);
    queue.markAttempt(oldest.id);
    expect(queue.oldestAttempts()).toBe(2);
    expect(queue.peek(1)[0].eventId).toBe('b');
    queue.close();
  });
  it('reads the oldest entry\'s capture time and retry count for the local page', () => {
    const queue = new SQLitePriorityQueue(':memory:');
    expect(queue.oldestEntry()).toBeNull();
    const before = Math.floor(Date.now() / 1000) * 1000;
    queue.enqueue('a', PriorityTier.P3_TELEMETRY, { n: 1 });
    queue.enqueue('b', PriorityTier.P0_SOS, { n: 2 });
    const [oldest] = queue.peek(10).filter((row) => row.eventId === 'a');
    queue.markAttempt(oldest.id);
    const entry = queue.oldestEntry();
    expect(entry?.retryCount).toBe(1);
    expect(entry?.capturedAt).toBeGreaterThanOrEqual(before);
    expect(entry?.capturedAt).toBeLessThanOrEqual(Date.now());
    queue.close();
  });
});
