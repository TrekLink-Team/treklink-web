import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLitePriorityQueue } from './priority-queue';

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
});
