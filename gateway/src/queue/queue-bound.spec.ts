import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PriorityTier, QueueLogger, SQLitePriorityQueue } from './priority-queue';

const { P0_SOS, P1_LOCATION, P2_GPS, P3_TELEMETRY } = PriorityTier;

// The queue bound of REQ-STA-03 (gateway-sync design §3, E02-5): shed the oldest P3, then the oldest P2,
// never P0 or P1, every shed logged and counted, insert and shed in one transaction.
describe('SQLitePriorityQueue bound (QUEUE_MAX_ROWS)', () => {
  let logger: QueueLogger & { warn: jest.Mock; error: jest.Mock };
  const open = (maxRows: number, path = ':memory:') => new SQLitePriorityQueue(path, { maxRows, logger });
  const ids = (queue: SQLitePriorityQueue) => queue.peek(1000).map((row) => row.eventId);
  const fill = (queue: SQLitePriorityQueue, rows: [string, PriorityTier][]) => {
    for (const [eventId, tier] of rows) queue.enqueue(eventId, tier, { sender: '!de000009' });
  };

  beforeEach(() => {
    logger = { warn: jest.fn(), error: jest.fn() };
  });

  it('keeps every row while the queue is under or at its bound', () => {
    const queue = open(3);
    fill(queue, [['a', P3_TELEMETRY], ['b', P3_TELEMETRY]]);
    const result = queue.enqueue('c', P3_TELEMETRY, {});
    expect(result).toEqual({ inserted: true, shed: [], overBound: false });
    expect(queue.count()).toBe(3);
    expect(logger.warn).not.toHaveBeenCalled();
    queue.close();
  });

  it('sheds the oldest P3 row first, even when the new row is a P2', () => {
    const queue = open(4);
    fill(queue, [['p2-old', P2_GPS], ['p3-old', P3_TELEMETRY], ['p0', P0_SOS], ['p3-new', P3_TELEMETRY]]);
    const result = queue.enqueue('p2-new', P2_GPS, {});
    expect(result.shed).toEqual([expect.objectContaining({ eventId: 'p3-old', priority: P3_TELEMETRY })]);
    expect(ids(queue)).toEqual(['p0', 'p2-old', 'p2-new', 'p3-new']);
    expect(queue.count()).toBe(4);
    queue.close();
  });

  it('sheds the oldest P2 row when no P3 row is left', () => {
    const queue = open(3);
    fill(queue, [['p1', P1_LOCATION], ['p2-old', P2_GPS], ['p2-new', P2_GPS]]);
    const result = queue.enqueue('p0', P0_SOS, {});
    expect(result.shed).toEqual([expect.objectContaining({ eventId: 'p2-old', priority: P2_GPS })]);
    expect(ids(queue)).toEqual(['p0', 'p1', 'p2-new']);
    queue.close();
  });

  it('sheds the new P3 row itself when it is the only P3 row', () => {
    const queue = open(2);
    fill(queue, [['p0', P0_SOS], ['p2', P2_GPS]]);
    const result = queue.enqueue('p3', P3_TELEMETRY, {});
    expect(result.shed).toEqual([expect.objectContaining({ eventId: 'p3', priority: P3_TELEMETRY })]);
    expect(ids(queue)).toEqual(['p0', 'p2']);
    queue.close();
  });

  it('never sheds P0 or P1: with only those left it keeps the new row and logs the bound exceeded', () => {
    const queue = open(2);
    fill(queue, [['p0-a', P0_SOS], ['p1-a', P1_LOCATION]]);
    const result = queue.enqueue('p0-b', P0_SOS, {});
    expect(result).toEqual({ inserted: true, shed: [], overBound: true });
    expect(ids(queue)).toEqual(['p0-a', 'p0-b', 'p1-a']);
    expect(queue.count()).toBe(3);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('exceeded'));
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('p0-b'));
    expect(logger.warn).not.toHaveBeenCalled();
    queue.close();
  });

  it('logs every shed with its tier and local id, and counts it per tier', () => {
    const queue = open(2);
    fill(queue, [['p3-a', P3_TELEMETRY], ['p2-a', P2_GPS], ['p0-a', P0_SOS], ['p0-b', P0_SOS]]);
    expect(logger.warn.mock.calls[0][0]).toMatch(/shed P3 row 1 \(event p3-a\)/);
    expect(logger.warn.mock.calls[1][0]).toMatch(/shed P2 row 2 \(event p2-a\)/);
    expect(queue.shedByTier()).toEqual([0, 0, 1, 1]);
    expect(queue.depthByTier()).toEqual([2, 0, 0, 0]);
    queue.close();
  });

  it('sheds nothing for a duplicate event id, which is not inserted', () => {
    const queue = open(1);
    fill(queue, [['p3', P3_TELEMETRY]]);
    expect(queue.enqueue('p3', P3_TELEMETRY, {})).toEqual({ inserted: false, shed: [], overBound: false });
    expect(ids(queue)).toEqual(['p3']);
    expect(queue.shedByTier()).toEqual([0, 0, 0, 0]);
    queue.close();
  });

  it('sheds down to a bound lowered between two runs, P3 then P2, on the next insert', () => {
    const root = mkdtempSync(join(tmpdir(), 'gateway-bound-'));
    const path = join(root, 'queue.db');
    try {
      const wide = open(10, path);
      fill(wide, [['p2-a', P2_GPS], ['p3-a', P3_TELEMETRY], ['p1-a', P1_LOCATION], ['p3-b', P3_TELEMETRY]]);
      wide.close();
      const narrow = open(2, path);
      const result = narrow.enqueue('p0-a', P0_SOS, {});
      expect(result.shed.map((row) => row.eventId)).toEqual(['p3-a', 'p3-b', 'p2-a']);
      expect(ids(narrow)).toEqual(['p0-a', 'p1-a']);
      narrow.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('runs the insert and the shed in one transaction: a failed shed leaves the queue as it was', () => {
    const root = mkdtempSync(join(tmpdir(), 'gateway-bound-'));
    const path = join(root, 'queue.db');
    try {
      const queue = open(1, path);
      fill(queue, [['p3-a', P3_TELEMETRY]]);
      // A second connection makes every delete fail, the way a full disk or a corrupt page would.
      const side = new Database(path);
      side.exec(`CREATE TRIGGER no_delete BEFORE DELETE ON event_queue
                 BEGIN SELECT RAISE(ABORT, 'delete refused'); END;`);
      side.close();
      expect(() => queue.enqueue('p3-b', P3_TELEMETRY, {})).toThrow('delete refused');
      expect(ids(queue)).toEqual(['p3-a']);
      expect(queue.shedByTier()).toEqual([0, 0, 0, 0]);
      expect(logger.warn).not.toHaveBeenCalled();
      queue.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses a bound under 1', () => {
    expect(() => open(0)).toThrow('at least 1');
  });
});
