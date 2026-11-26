import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_REFUSALS, PriorityTier, REFUSED_KEEP_ROWS, SQLitePriorityQueue } from './priority-queue';

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

// web#558: a row the broker refuses MAX_REFUSALS times leaves the live queue for the refused list.
describe('SQLitePriorityQueue refused rows', () => {
  const silent = { logger: { warn: () => undefined, error: () => undefined } };
  const packet = (n: number) => ({ id: n, sender: '!de00000b', type: 'position' });

  it('counts each refusal and moves the row out at the third, with its reason code and count', () => {
    const queue = new SQLitePriorityQueue(':memory:', silent);
    queue.enqueue('ev-1', PriorityTier.P2_GPS, packet(1));
    queue.enqueue('ev-2', PriorityTier.P2_GPS, packet(2));
    const [first] = queue.peek(1);
    expect(MAX_REFUSALS).toBe(3);
    expect(queue.markRefused(first.id, 135)).toEqual({ refusals: 1, movedOut: false });
    expect(queue.markRefused(first.id, 135)).toEqual({ refusals: 2, movedOut: false });
    expect(queue.peek(1)[0]).toMatchObject({ eventId: 'ev-1', retryCount: 2 });
    expect(queue.markRefused(first.id, 135)).toEqual({ refusals: 3, movedOut: true });

    expect(queue.count()).toBe(1);
    expect(queue.peek(5).map((row) => row.eventId)).toEqual(['ev-2']);
    expect(queue.depthByTier()).toEqual([0, 0, 1, 0]);
    const summary = queue.refusedSummary();
    expect(summary.total).toBe(1);
    expect(summary.recent[0]).toMatchObject({ eventId: 'ev-1', priority: 2, reasonCode: 135, refusals: 3 });
    expect(Number.isFinite(summary.recent[0].refusedAt)).toBe(true);
    queue.close();
  });

  it('changes nothing for a row already gone', () => {
    const queue = new SQLitePriorityQueue(':memory:', silent);
    expect(queue.markRefused(999, 135)).toEqual({ refusals: 0, movedOut: false });
    expect(queue.refusedSummary().total).toBe(0);
    queue.close();
  });

  it(`keeps the newest ${REFUSED_KEEP_ROWS} refused rows only`, () => {
    const queue = new SQLitePriorityQueue(':memory:', silent);
    const extra = 5;
    for (let n = 0; n < REFUSED_KEEP_ROWS + extra; n += 1) {
      queue.enqueue(`ev-${n}`, PriorityTier.P3_TELEMETRY, packet(n));
      const [row] = queue.peek(1);
      for (let i = 0; i < MAX_REFUSALS; i += 1) queue.markRefused(row.id, 135);
    }
    const summary = queue.refusedSummary(1);
    expect(summary.total).toBe(REFUSED_KEEP_ROWS);
    expect(summary.recent[0].eventId).toBe(`ev-${REFUSED_KEEP_ROWS + extra - 1}`);
    queue.close();
  });

  it('adds the refusal count to a queue file written before web#558, keeping its rows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gateway-queue-old-'));
    const dbPath = join(dir, 'old.db');
    const old = new Database(dbPath);
    old.exec(`CREATE TABLE event_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT UNIQUE NOT NULL, priority INTEGER NOT NULL,
      payload TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      retry_count INTEGER NOT NULL DEFAULT 0)`);
    old.prepare('INSERT INTO event_queue (event_id, priority, payload) VALUES (?, ?, ?)').run('ev-old', 2, '{}');
    old.close();

    const queue = new SQLitePriorityQueue(dbPath, silent);
    const [row] = queue.peek(1);
    expect(row.eventId).toBe('ev-old');
    expect(queue.markRefused(row.id, 135)).toEqual({ refusals: 1, movedOut: false });
    queue.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
