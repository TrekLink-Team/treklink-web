import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import pino from 'pino';
import { gatewayConfig, PriorityTier } from '../config';

export { PriorityTier };

/** The tiers the bound may shed, in the order it sheds them (REQ-STA-03): P3, then P2. */
export const SHEDDABLE_TIERS: readonly PriorityTier[] = [PriorityTier.P3_TELEMETRY, PriorityTier.P2_GPS];

/**
 * Broker refusals (PUBACK reason code 0x80 or higher) after which a row leaves the live queue for the
 * refused list (web#558). A refusal such as a node outside the station's custody (web#547) is permanent:
 * kept in the queue, 20 such rows at the head of a tier would fill every batch and stall the rows behind.
 * Three tries let a transient refusal pass.
 */
export const MAX_REFUSALS = 3;

/** How many refused rows the refused list keeps, newest first; older ones are deleted. */
export const REFUSED_KEEP_ROWS = 200;

/** One row the broker refused MAX_REFUSALS times, as the local page shows it. */
export interface RefusedEvent {
  eventId: string;
  priority: number;
  reasonCode: number;
  refusals: number;
  /** Station clock, epoch ms, when the row left the queue. */
  refusedAt: number;
}

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
  private refuseTx!: (id: number, reasonCode: number) => { refusals: number; movedOut: boolean };

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
      -- Rows the broker refused MAX_REFUSALS times (web#558): out of the live queue, kept for the local page.
      CREATE TABLE IF NOT EXISTS refused_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL,
        priority INTEGER NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        refused_at TEXT NOT NULL DEFAULT (datetime('now')),
        reason_code INTEGER NOT NULL,
        refusals INTEGER NOT NULL
      );
    `);
    // A queue file written before web#558 has no refusal_count column.
    const columns = this.db.prepare('PRAGMA table_info(event_queue)').all() as { name: string }[];
    if (!columns.some((column) => column.name === 'refusal_count')) {
      this.db.exec('ALTER TABLE event_queue ADD COLUMN refusal_count INTEGER NOT NULL DEFAULT 0');
    }
    this.prepareEnqueue();
    this.prepareRefuse();
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

  // The count, the move to the refused list and the trim of that list commit together.
  private prepareRefuse(): void {
    const count = this.db.prepare(
      'UPDATE event_queue SET retry_count = retry_count + 1, refusal_count = refusal_count + 1 WHERE id = ?',
    );
    const read = this.db.prepare('SELECT refusal_count as refusals FROM event_queue WHERE id = ?');
    const moveOut = this.db.prepare(`
      INSERT INTO refused_events (event_id, priority, payload, created_at, reason_code, refusals)
      SELECT event_id, priority, payload, created_at, ?, refusal_count FROM event_queue WHERE id = ?
    `);
    const remove = this.db.prepare('DELETE FROM event_queue WHERE id = ?');
    const trim = this.db.prepare(
      'DELETE FROM refused_events WHERE id NOT IN (SELECT id FROM refused_events ORDER BY id DESC LIMIT ?)',
    );
    this.refuseTx = this.db.transaction((id: number, reasonCode: number) => {
      if (count.run(id).changes === 0) return { refusals: 0, movedOut: false };
      const { refusals } = read.get(id) as { refusals: number };
      if (refusals < MAX_REFUSALS) return { refusals, movedOut: false };
      moveOut.run(reasonCode, id);
      remove.run(id);
      trim.run(REFUSED_KEEP_ROWS);
      return { refusals, movedOut: true };
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

  /**
   * Rows the bound shed since this process started, index 0 = P0 .. 3 = P3.
   *
   * The count, like the shed log line, is of rows the bound deleted from SQLite; it is an upper bound on
   * the events lost, not an exact loss count. The queue does not know which rows a flush has published
   * and is waiting on, so the oldest P3, often the one in flight, can be shed with its PUBACK pending.
   * The shed counts and logs it, and the client's later `remove()` on the PUBACK finds no row. Then:
   * - the connection holds and the broker acknowledges it: the event reaches the backend although it is
   *   counted shed;
   * - the connection drops first: `GatewayMqttClient` discards the client's copy on close, so it is not
   *   resent and the event is lost as counted, unless the broker had already taken it and only the
   *   PUBACK was lost, in which case it was delivered once.
   * `flush-outage.spec.ts` tests both cases.
   */
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

  /**
   * Records a publish the broker refused (web#558). The row's attempt and refusal counts go up; at
   * MAX_REFUSALS it leaves the live queue for the refused list, so it is never sent again and no longer
   * holds a place in a batch. A row already gone (shed meanwhile) changes nothing.
   */
  public markRefused(id: number, reasonCode: number): { refusals: number; movedOut: boolean } {
    return this.refuseTx(id, reasonCode);
  }

  /** The refused list for the local page: how many rows it keeps and the newest `limit` of them. */
  public refusedSummary(limit = 5): { total: number; recent: RefusedEvent[] } {
    const { total } = this.db.prepare('SELECT count(*) as total FROM refused_events').get() as {
      total: number;
    };
    const rows = this.db
      .prepare(
        `SELECT event_id as eventId, priority, reason_code as reasonCode, refusals, refused_at as refusedAt
         FROM refused_events ORDER BY id DESC LIMIT ?`,
      )
      .all(limit) as (Omit<RefusedEvent, 'refusedAt'> & { refusedAt: string })[];
    return {
      total,
      recent: rows.map((row) => ({ ...row, refusedAt: Date.parse(`${row.refusedAt.replace(' ', 'T')}Z`) })),
    };
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

  /**
   * The oldest queued entry's capture time (station clock, epoch ms) and retry count, or null when the
   * queue is empty; the local page shows its age (field-station-local-page.md, `/local/queue`).
   * `created_at` is SQLite `datetime('now')`, UTC to the second.
   */
  public oldestEntry(): { capturedAt: number; retryCount: number } | null {
    const row = this.db
      .prepare('SELECT created_at as createdAt, retry_count as retryCount FROM event_queue ORDER BY id ASC LIMIT 1')
      .get() as { createdAt: string; retryCount: number } | undefined;
    if (!row) return null;
    return { capturedAt: Date.parse(`${row.createdAt.replace(' ', 'T')}Z`), retryCount: row.retryCount };
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
