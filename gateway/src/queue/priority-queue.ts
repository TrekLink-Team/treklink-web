import Database from 'better-sqlite3';

export enum PriorityTier {
  P0_SOS = 0,
  P1_LOCATION = 1,
  P2_GPS = 2,
  P3_TELEMETRY = 3,
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

  constructor(dbPath: string = ':memory:') {
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
    `);
  }

  public enqueue(eventId: string, priority: PriorityTier, payload: object | string): void {
    const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO event_queue (event_id, priority, payload, created_at)
      VALUES (?, ?, ?, datetime('now'))
    `);
    stmt.run(eventId, priority, payloadStr);
  }

  public peek(limit: number = 10): QueuedEvent[] {
    const stmt = this.db.prepare(`
      SELECT id, event_id as eventId, priority, payload, created_at as createdAt, retry_count as retryCount
      FROM event_queue
      ORDER BY priority ASC, created_at ASC
      LIMIT ?
    `);
    return stmt.all(limit) as QueuedEvent[];
  }

  public remove(id: number): void {
    const stmt = this.db.prepare('DELETE FROM event_queue WHERE id = ?');
    stmt.run(id);
  }

  public count(): number {
    const row = this.db.prepare('SELECT count(*) as count FROM event_queue').get() as { count: number };
    return row.count;
  }

  public close(): void {
    this.db.close();
  }
}
