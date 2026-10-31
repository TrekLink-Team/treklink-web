import { randomUUID } from 'node:crypto';
import { IngressPath, SyncOutcome } from '@prisma/client';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { DevicesService } from '../src/modules/devices';
import {
  RAW_EXCERPT_MAX_CHARS,
  SyncAuditService,
} from '../src/modules/gateway-sync/sync-audit.service';
import { SyncQueryRepository } from '../src/modules/gateway-sync/sync-query.repository';

// Capture explicit connection settings before Prisma can load a local .env at construction.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !process.env.DATABASE_DIRECT_URL) {
  throw new Error('test:db requires explicit DATABASE_URL and DATABASE_DIRECT_URL.');
}

// The sync audit reads (api-design 04 and 07) against Postgres: listAudit pages the append-only rows
// newest first, filters by outcome and time, answers the raw payload of a malformed row only and
// truncated, and the outcome counts of syncStatus see each rejection outcome. Fixtures carry a fresh
// run ID in their uplink key and are never deleted (the table is append-only).
describe('SyncAuditService.listAudit and the outcome counts on Postgres', () => {
  const prisma = new PrismaService({ datasourceUrl: databaseUrl });
  const repository = new SyncQueryRepository(prisma);
  const service = new SyncAuditService(repository, {
    assetTags: () => Promise.resolve(new Map()),
  } as unknown as DevicesService);
  const runId = randomUUID();
  const uplinkKey = `audit-test-${runId.slice(0, 8)}`;
  const base = Date.now() - 10 * 60_000;
  const at = (second: number) => new Date(base + second * 1000);
  const longText = `{"broken": "${'x'.repeat(RAW_EXCERPT_MAX_CHARS)}`;

  beforeAll(async () => {
    await prisma.$connect();
    const rows: [number, SyncOutcome, unknown][] = [
      [0, SyncOutcome.ACCEPTED, { type: 'position' }],
      [1, SyncOutcome.MALFORMED_ENVELOPE, 'not json {'],
      [2, SyncOutcome.NORMALIZATION_FAILED, { type: 'text' }],
      [3, SyncOutcome.ACCEPTED_UNATTRIBUTED, { type: 'telemetry' }],
      [4, SyncOutcome.UNKNOWN_DEVICE, { type: 'position' }],
      [5, SyncOutcome.MALFORMED_ENVELOPE, longText],
    ];
    for (const [second, outcome, raw] of rows) {
      await prisma.syncAuditLog.create({
        data: {
          ingress: IngressPath.MQTT_NODE,
          uplinkKey,
          outcome,
          detail: `${outcome} ${second}`,
          rawMessage: raw as never,
          createdAt: at(second),
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('pages the run rows newest first', async () => {
    const first = await service.listAudit({ op: 'listAudit', uplinkKey, pageSize: 4 });
    expect(first.totalCount).toBe(6);
    expect(first.totalPages).toBe(2);
    expect(first.items.map((item) => item.detail)).toEqual([
      'MALFORMED_ENVELOPE 5',
      'UNKNOWN_DEVICE 4',
      'ACCEPTED_UNATTRIBUTED 3',
      'NORMALIZATION_FAILED 2',
    ]);
    const second = await service.listAudit({
      op: 'listAudit',
      uplinkKey,
      pageSize: 4,
      pageNumber: 2,
    });
    expect(second.items.map((item) => item.detail)).toEqual(['MALFORMED_ENVELOPE 1', 'ACCEPTED 0']);
  });

  it('filters by outcome and time and answers only a malformed raw payload, truncated', async () => {
    const malformed = await service.listAudit({
      op: 'listAudit',
      uplinkKey,
      outcome: [SyncOutcome.MALFORMED_ENVELOPE],
    });
    expect(malformed.items).toHaveLength(2);
    expect(malformed.items[0]).toMatchObject({
      rawTruncated: true,
      rawExcerpt: longText.slice(0, RAW_EXCERPT_MAX_CHARS),
    });
    expect(malformed.items[1]).toMatchObject({ rawExcerpt: 'not json {', rawTruncated: false });

    const window = await service.listAudit({
      op: 'listAudit',
      uplinkKey,
      outcome: [SyncOutcome.NORMALIZATION_FAILED, SyncOutcome.ACCEPTED_UNATTRIBUTED],
      from: at(2),
      to: at(2),
    });
    expect(window.items).toHaveLength(1);
    expect(window.items[0]).toMatchObject({
      outcome: SyncOutcome.NORMALIZATION_FAILED,
      rawExcerpt: null,
      rawTruncated: false,
    });
  });

  it('counts each rejection outcome of the window', async () => {
    const counts = await repository.outcomesSince(at(0));
    // Other suites may write audit rows in the same window, so the run's rows are a lower bound.
    expect(counts.get(SyncOutcome.MALFORMED_ENVELOPE)).toBeGreaterThanOrEqual(2);
    expect(counts.get(SyncOutcome.NORMALIZATION_FAILED)).toBeGreaterThanOrEqual(1);
    expect(counts.get(SyncOutcome.ACCEPTED_UNATTRIBUTED)).toBeGreaterThanOrEqual(1);
    expect(counts.get(SyncOutcome.UNKNOWN_DEVICE)).toBeGreaterThanOrEqual(1);
  });
});
