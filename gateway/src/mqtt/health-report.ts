import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The Field Station health payload (gateway-sync mqtt-ingress-contract.md, "Field Station health").
export const HEALTH_SCHEMA = 'treklink.fs_health';

export interface HealthReport {
  schema: typeof HEALTH_SCHEMA;
  v: 1;
  version: string;
  depth: number[];
  oldest_attempts: number | null;
  last_flush_at: number | null;
  sent_at: number;
}

export interface QueueHealthSource {
  depthByTier(): number[];
  oldestAttempts(): number | null;
}

export const healthTopic = (root: string, username: string): string => `${root}/fs/${username}/health`;

export const buildHealthReport = (
  queue: QueueHealthSource,
  version: string,
  lastFlushAt: number | null,
  now: number = Date.now(),
): HealthReport => ({
  schema: HEALTH_SCHEMA,
  v: 1,
  version,
  depth: queue.depthByTier(),
  oldest_attempts: queue.oldestAttempts(),
  last_flush_at: lastFlushAt,
  sent_at: now,
});

// The executable's version is the gateway package version (FR-EVT-18); the file sits two folders up from
// both `src/mqtt` and `dist/mqtt`.
export const gatewayVersion = (): string => {
  try {
    const raw = readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8');
    const version = (JSON.parse(raw) as { version?: unknown }).version;
    return typeof version === 'string' && version !== '' ? version : 'unknown';
  } catch {
    return 'unknown';
  }
};
