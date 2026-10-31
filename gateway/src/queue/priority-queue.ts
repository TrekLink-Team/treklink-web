import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import pino from 'pino';
import { gatewayConfig, PriorityTier } from '../config';

export { PriorityTier };

/** The tiers the bound may shed, in the order it sheds them (REQ-STA-03): P3, then P2. */
export const SHEDDABLE_TIERS: readonly PriorityTier[] = [PriorityTier.P3_TELEMETRY, PriorityTier.P2_GPS];

/** One row the bound removed. */
export interface ShedRow {
  id: number;
  eventId: string;
  priority: PriorityTier;
}

export interface EnqueueResult {
  /** False when the event id was already queued (INSERT OR IGNORE). */
  inserted: boolean;
  /** Rows the bound removed in the same transaction, oldest first. */
  shed: ShedRow[];
  /** True when the queue stays over the bound because only P0 and P1 rows are left to shed. */
  overBound: boolean;
}

/** The subset of pino the queue logs through, so a test can watch it. */
export interface QueueLogger {
  warn(message: string): void;
  error(message: string): void;
}

export interface QueueOptions {
  /** `QUEUE_MAX_ROWS`; defaults to GATEWAY_QUEUE_MAX_ROWS. */
  maxRows?: number;
  logger?: QueueLogger;
}

export interface QueuedEvent {
  id: number;
  eventId: string;
  priority: number;
  payload: string;
  createdAt: string;
  retryCount: number;
}

export class SQLitePriorityQueue {
  private db: Database.Database;
  private readonly maxRows: number;
  private readonly logger: QueueLogger;
  /** Rows shed since this process started, index 0 = P0 .. 3 = P3; only P2 and P3 can be non-zero. */
  private readonly shedCount = [0, 0, 0, 0];
  private enqueueTx!: (eventId: string, priority: PriorityTier, payload: string) => EnqueueResult;

  constructor(dbPath: string = gatewayConfig.queue.dbPath, options: QueueOptions = {}) {
    this.maxRows = options.maxRows ?? gatewayConfig.queue.maxRows;
    if (!Number.isInteger(this.maxRows) || this.maxRows < 1) {
      throw new Error(`The queue bound must be a whole number of at least 1: ${this.maxRows}`);
    }
    this.logger = options.logger ?? pino({ name: 'GatewayQueue' });
    // A fresh clone has no folder for GATEWAY_SQLITE_DB_PATH (./data/ by default); SQLite creates the
    // file but not its folder. An in-memory database has no folder to create.
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS event_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT UNIQUE NOT NULL,
        priority INTEGER NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        retry_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_priority_created ON event_queue (priority ASC, created_at ASC);
      -- Within one priority this index is in rowid order, so the oldest row of a tier (the shed) and the
      -- flush order (priority, id) are index lookups rather than scans of the tier.
      CREATE INDEX IF NOT EXISTS idx_priority_id ON event_queue (priority ASC);
    `);
    this.prepareEnqueue();
  }

  // The insert and every shed it causes commit together (better-sqlite3 transaction), so a crash leaves
  // either the old queue or the new one, never a new row with the bound broken or a shed without its row.
  private prepareEnqueue(): void {
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO event_queue (event_id, priority, payload, created_at)
      VALUES (?, ?, ?, datetime('now'))
    `);
    const count = this.db.prepare('SELECT count(*) as count FROM event_queue');
    const oldestOf = this.db.prepare(
      'SELECT id, event_id as eventId, priority FROM event_queue WHERE priority = ? ORDER BY id ASC LIMIT 1',
    );
    const remove = this.db.prepare('DELETE FROM event_queue WHERE id = ?');

    this.enqueueTx = this.db.transaction((eventId: string, priority: PriorityTier, payload: string) => {
      const result: EnqueueResult = { inserted: false, shed: [], overBound: false };
      result.inserted = insert.run(eventId, priority, payload).changes === 1;
      if (!result.inserted) return result;
      let rows = (count.get() as { count: number }).count;
      // Normally one row; more only when the bound was lowered between two runs.
      while (rows > this.maxRows) {
        let victim: ShedRow | undefined;
        for (const tier of SHEDDABLE_TIERS) {
          victim = oldestOf.get(tier) as ShedRow | undefined;
          if (victim) break;
        }
        if (!victim) {
          result.overBound = true;
          break;
        }
        remove.run(victim.id);
        result.shed.push(victim);
        rows -= 1;
      }
      return result;
    });
  }

  /**
   * Persists one event before any network attempt (REQ-STA-01). When the insert takes the queue past
   * `QUEUE_MAX_ROWS` the oldest P3 row goes, then the oldest P2; a P0 or P1 row is never shed, so with
   * only those left the new row stays and the queue runs over its bound (REQ-STA-03, E02-5).
   */
  public enqueue(eventId: string, priority: PriorityTier, payload: object | string): EnqueueResult {
    const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const result = this.enqueueTx(eventId, priority, payloadStr);
    // Logged after the commit, so a log line never names a shed that rolled back.
    for (const row of result.shed) {
      this.shedCount[row.priority] += 1;
      this.logger.warn(
        `Queue bound ${this.maxRows} reached: shed P${row.priority} row ${row.id} (event ${row.eventId}).`,
      );
    }
    // The over-bound line describes the queue after the shed. The shed may have taken the new row itself
    // (a P3 inserted into a queue of P0 rows), and then the line must not claim it was kept.
    if (result.overBound) {
      const kept = result.shed.some((row) => row.eventId === eventId) ? 'shed' : 'kept';
      this.logger.error(
        `Queue bound ${this.maxRows} exceeded: ${this.count()} rows queued, all P0 or P1, which are never shed; ` +
          `new event ${eventId} ${kept}.`,
      );
    }
    return result;
  }

  /** Rows the bound shed since this process started, index 0 = P0 .. 3 = P3. */
  public shedByTier(): number[] {
    return [...this.shedCount];
  }

  public peek(limit: number = gatewayConfig.queue.peekLimit): QueuedEvent[] {
    const stmt = this.db.prepare(`
      SELECT id, event_id as eventId, priority, payload, created_at as createdAt, retry_count as retryCount
      FROM event_queue
      ORDER BY priority ASC, id ASC
      LIMIT ?
    `);
    return stmt.all(limit) as QueuedEvent[];
  }

  public remove(id: number): void {
    const stmt = this.db.prepare('DELETE FROM event_queue WHERE id = ?');
    stmt.run(id);
  }

  // Records a failed publish of a row, so the health report can show how often the oldest entry was tried.
  public markAttempt(id: number): void {
    this.db.prepare('UPDATE event_queue SET retry_count = retry_count + 1 WHERE id = ?').run(id);
  }

  /** Queued entries per tier, index 0 = P0 .. 3 = P3 (the health report's `depth`). */
  public depthByTier(): number[] {
    const rows = this.db
      .prepare('SELECT priority, count(*) as count FROM event_queue GROUP BY priority')
      .all() as { priority: number; count: number }[];
    const depth = [0, 0, 0, 0];
    for (const row of rows) if (row.priority >= 0 && row.priority < depth.length) depth[row.priority] = row.count;
    return depth;
  }

  /** The retry count of the oldest queued entry, or null when the queue is empty. */
  public oldestAttempts(): number | null {
    const row = this.db
      .prepare('SELECT retry_count as retryCount FROM event_queue ORDER BY id ASC LIMIT 1')
      .get() as { retryCount: number } | undefined;
    return row ? row.retryCount : null;
  }

  public count(): number {
    const row = this.db.prepare('SELECT count(*) as count FROM event_queue').get() as {
      count: number;
    };
    return row.count;
  }

  public close(): void {
    this.db.close();
  }
}
