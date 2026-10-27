import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ParameterType, Prisma } from '@prisma/client';
import { DomainException, ErrorCode } from '../../../common/errors';
import { ValidatedEnvironment } from '../config/environment-variables';
import { AUDIT_RECORD, AuditRecordEvent } from '../audit/audit-record.event';
import { TransactionalEvents } from '../events/emit-after-commit';
import { ParameterKey, ParameterValue } from './parameter-registry';
import { ParameterRepository, ParameterRow } from './parameter.repository';

export const PARAMETER_CHANGED = 'parameter.changed';

export interface ParameterChangedEvent {
  key: string;
  version: number;
}

export interface ParameterUpdate {
  value: unknown;
  expectedVersion: number;
  reason?: string | null;
}

export interface ParameterActor {
  id: string;
  roles: string[];
}

interface CacheEntry {
  value: Prisma.JsonValue;
  expiresAt: number;
}

const NUMERIC_TYPES: ReadonlySet<ParameterType> = new Set([
  'INT',
  'DECIMAL',
  'PERCENT',
  'DURATION_SECONDS',
]);

const isBounds = (bounds: unknown): bounds is { min?: number; max?: number } =>
  typeof bounds === 'object' && bounds !== null && !Array.isArray(bounds);

const outOfRange = (message: string) =>
  new DomainException(HttpStatus.BAD_REQUEST, ErrorCode.PARAMETER_OUT_OF_RANGE, message);

// Type and bounds check of a new value (REQ-EVT-03, REQ-ERR-05). The bounds are the stored row's;
// an Admin changes values, never bounds.
export const assertValueFits = (
  row: Pick<ParameterRow, 'valueType' | 'bounds'>,
  value: unknown,
) => {
  const type = row.valueType;
  if (type === 'BOOL') {
    if (typeof value !== 'boolean') throw outOfRange('value must be true or false.');
    return;
  }
  if (type === 'JSON') {
    if (value === undefined || value === null) throw outOfRange('value must be a JSON value.');
    return;
  }
  if (!NUMERIC_TYPES.has(type) || typeof value !== 'number' || !Number.isFinite(value)) {
    throw outOfRange('value must be a number.');
  }
  if ((type === 'INT' || type === 'DURATION_SECONDS') && !Number.isInteger(value)) {
    throw outOfRange('value must be a whole number.');
  }
  if (isBounds(row.bounds)) {
    const { min, max } = row.bounds;
    if ((min !== undefined && value < min) || (max !== undefined && value > max)) {
      const range =
        min !== undefined && max !== undefined
          ? `between ${min} and ${max}`
          : min !== undefined
            ? `at least ${min}`
            : `at most ${max}`;
      throw outOfRange(`value must be ${range}.`);
    }
  }
};

// Runtime business parameters (specs/platform/design.md §4.4, FR-CFG-01, FR-CFG-02). Reads go
// through a per-instance cache with TTL PARAMETER_CACHE_TTL_SECONDS; inside a transaction the value
// read first is reused for the rest of that transaction (REQ-STA-02).
@Injectable()
export class ParameterService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly transactionReads = new WeakMap<object, Map<string, Prisma.JsonValue>>();
  private readonly ttlMs: number;

  constructor(
    private readonly repository: ParameterRepository,
    private readonly events: TransactionalEvents,
    config: ConfigService<ValidatedEnvironment, true>,
  ) {
    this.ttlMs = config.get('PARAMETER_CACHE_TTL_SECONDS', { infer: true }) * 1000;
  }

  async get<K extends ParameterKey>(
    key: K,
    tx?: Prisma.TransactionClient,
  ): Promise<ParameterValue<K>> {
    if (!tx) return (await this.readThroughCache(key)) as ParameterValue<K>;

    let reads = this.transactionReads.get(tx);
    if (!reads) {
      reads = new Map();
      this.transactionReads.set(tx, reads);
    }
    if (!reads.has(key)) reads.set(key, await this.readThroughCache(key, tx));
    return reads.get(key) as ParameterValue<K>;
  }

  async update(key: string, change: ParameterUpdate, actor: ParameterActor): Promise<ParameterRow> {
    const updated = await this.events.transaction(async (tx) => {
      const current = await this.repository.lockAndFind(key, tx);
      if (!current) {
        throw new DomainException(
          HttpStatus.NOT_FOUND,
          ErrorCode.NOT_FOUND,
          'Parameter not found.',
        );
      }
      assertValueFits(current, change.value);
      if (current.version !== change.expectedVersion) {
        throw new DomainException(
          HttpStatus.CONFLICT,
          ErrorCode.STALE_VERSION,
          'This was changed by someone else. Reload and try again.',
        );
      }

      const newValue = change.value as Prisma.InputJsonValue;
      const previousValue = current.value as Prisma.InputJsonValue;
      const row = await this.repository.updateValue(
        key,
        newValue,
        current.version + 1,
        actor.id,
        tx,
      );
      await this.repository.appendHistory(
        { key, previousValue, newValue, changedById: actor.id, reason: change.reason ?? null },
        tx,
      );

      this.events.emitAfterCommit(PARAMETER_CHANGED, {
        key,
        version: row.version,
      } satisfies ParameterChangedEvent);
      this.events.emitAfterCommit(AUDIT_RECORD, {
        actorId: actor.id,
        actorRoles: actor.roles,
        organizationId: null,
        action: 'parameter.update',
        subjectType: 'BusinessParameter',
        subjectId: key,
        before: { value: current.value, version: current.version },
        after: { value: row.value, version: row.version, reason: change.reason ?? null },
      } satisfies AuditRecordEvent);
      return row;
    });

    this.cache.delete(key);
    return updated;
  }

  // A cache miss inside a caller's transaction reads through that transaction, so the value is in its
  // snapshot and a single-session database does not wait on the open transaction (issue #87 point 3).
  private async readThroughCache(
    key: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Prisma.JsonValue> {
    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > now) return cached.value;

    const row = await this.repository.findByKey(key, tx);
    // A registry key without a seeded row is a deployment fault, so it surfaces as a 500.
    if (!row) throw new Error(`Business parameter ${key} is not seeded`);
    this.cache.set(key, { value: row.value, expiresAt: now + this.ttlMs });
    return row.value;
  }
}
