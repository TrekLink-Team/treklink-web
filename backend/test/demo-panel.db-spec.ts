import './db-app-env';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../src/common/prisma/prisma.service';
import {
  AUDIT_RECORD,
  type AuditRecordEvent,
} from '../src/modules/platform/audit/audit-record.event';

// Capture explicit connection settings before Prisma can load a local .env at construction.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !process.env.DATABASE_DIRECT_URL) {
  throw new Error('test:db requires explicit DATABASE_URL and DATABASE_DIRECT_URL.');
}
if (/\.neon\.tech/i.test(databaseUrl)) {
  throw new Error('demo-panel.db-spec wipes the database; never run it against Neon.');
}

// The panel loads only with a hash that parses (REQ-PNL-01); the reseed runs only on the demo host with
// its flag (REQ-PNL-12). Here the disposable database's own host stands in for the Neon demo branch.
process.env.DEMO_PANEL_PASSWORD_HASH = `scrypt:${'ab'.repeat(16)}:${'cd'.repeat(32)}`;
process.env.DEMO_RESET_ENABLED = 'true';
process.env.DEMO_DATABASE_HOST = new URL(databaseUrl).hostname;
const PASSWORD = 'Demo-panel-1';
for (const role of ['ADMIN', 'STAFF', 'MANAGER', 'OPERATOR']) {
  process.env[`SEED_${role}_PASSWORD`] = PASSWORD;
}
process.env.BCRYPT_COST = '4';

// specs/demo AC-PNL-03 and AC-PNL-04 on Postgres, in a schema of its own (as demo-controls.db-spec).
describe('demo panel reseed and actions on Postgres (D-110)', () => {
  const schema = `demo_panel_${randomUUID().slice(0, 8)}`;
  const url = new URL(databaseUrl);
  url.searchParams.set('schema', schema);
  const prisma = new PrismaService({ datasourceUrl: url.toString() });
  let close: () => Promise<void>;
  let resets: import('../src/modules/demo/demo-panel-reset.service').DemoPanelResetService;
  let panel: import('../src/modules/demo/demo-panel.service').DemoPanelService;
  const audits: AuditRecordEvent[] = [];
  const writes: Promise<unknown>[] = [];

  // The schema objects a reseed must leave as they are: tables, columns, constraints, indexes, triggers.
  const schemaShape = () =>
    prisma.$queryRawUnsafe<{ kind: string; name: string }[]>(`
      SELECT 'table' AS kind, table_name || '.' || column_name || ':' || data_type AS name
        FROM information_schema.columns WHERE table_schema = '${schema}'
      UNION ALL SELECT 'constraint', conrelid::regclass::text || '.' || conname || ':' || pg_get_constraintdef(oid)
        FROM pg_constraint WHERE connamespace = '${schema}'::regnamespace
      UNION ALL SELECT 'index', indexname || ':' || indexdef FROM pg_indexes WHERE schemaname = '${schema}'
      UNION ALL SELECT 'trigger', tgrelid::regclass::text || '.' || tgname FROM pg_trigger
        WHERE NOT tgisinternal AND tgrelid::regclass::text LIKE '%'
      ORDER BY 1, 2`);

  beforeAll(async () => {
    execFileSync(
      process.execPath,
      [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'],
      {
        cwd: join(__dirname, '..'),
        env: { ...process.env, DATABASE_URL: url.toString(), DATABASE_DIRECT_URL: url.toString() },
        stdio: 'pipe',
      },
    );
    process.env.DATABASE_URL = url.toString();
    process.env.DATABASE_DIRECT_URL = url.toString();
    const { AppModule } = await import('../src/app.module');
    const { DemoPanelResetService } = await import('../src/modules/demo/demo-panel-reset.service');
    const { DemoPanelService } = await import('../src/modules/demo/demo-panel.service');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    close = () => moduleRef.close();
    resets = moduleRef.get(DemoPanelResetService, { strict: false });
    panel = moduleRef.get(DemoPanelService, { strict: false });
    // Compiled without init, the audit sink does not listen; the panel's audit events are caught here
    // and written as the sink would, so the reseed spacing reads them from audit_log.
    moduleRef.get(EventEmitter2).on(AUDIT_RECORD, (event: AuditRecordEvent) => {
      audits.push(event);
      writes.push(
        prisma.auditLog.create({
          data: {
            actorId: event.actorId,
            actorRoles: event.actorRoles,
            action: event.action,
            subjectType: event.subjectType,
            subjectId: event.subjectId,
            ip: event.ip ?? null,
          },
        }),
      );
    });
  }, 180_000);
  afterAll(async () => {
    await close?.();
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await prisma.$disconnect();
  });

  it('reseeds with data only: the seed contracts, one kept audit entry, the schema unchanged', async () => {
    const before = await schemaShape();
    // Leftovers of a rehearsal that the wipe must remove.
    await prisma.auditLog.create({
      data: { actorRoles: ['SYSTEM'], action: 'rehearsal.leftover', subjectType: 'Test' },
    });
    const result = await resets.reset('RESET DEMO DATA', '127.0.0.1');
    expect(result.tables).toBeGreaterThan(30);
    const codes = (await prisma.rentalContract.findMany({ orderBy: { code: 'asc' } })).map(
      (c) => c.code,
    );
    expect(codes).toEqual(['RC-2026-0001', 'RC-2026-0002', 'RC-2026-0003']);
    expect(await prisma.organization.count()).toBe(1);
    expect(await prisma.permission.count({ where: { key: 'demo.stage' } })).toBe(1);
    expect(await prisma.businessParameter.count()).toBeGreaterThan(40);
    await Promise.all(writes);
    expect(await prisma.auditLog.count({ where: { action: 'rehearsal.leftover' } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'demo.panel.reset' } })).toBe(1);
    expect(await schemaShape()).toEqual(before);
  }, 180_000);

  it('refuses a second reseed within five minutes, and changes nothing', async () => {
    const contracts = await prisma.rentalContract.count();
    await expect(resets.reset('RESET DEMO DATA', '127.0.0.1')).rejects.toMatchObject({
      errorCode: 'RATE_LIMITED',
    });
    expect(await prisma.rentalContract.count()).toBe(contracts);
  });

  it('sends a simulated SOS from TL-0010 and acknowledges it as the Operator (AC-PNL-04)', async () => {
    const device = await prisma.device.findUniqueOrThrow({ where: { assetTag: 'TL-0010' } });
    const sos = await panel.runAction('incident-sos', { deviceId: device.id }, '127.0.0.1');
    const incident = await prisma.incident.findFirstOrThrow({
      where: { deviceId: device.id, state: { not: 'CLOSED' } },
    });
    expect(incident.simulated).toBe(true);
    expect(sos.records[0].code).toBe(incident.code);
    const acknowledged = await panel.runAction(
      'incident-acknowledge',
      { recordId: incident.id, expectedVersion: incident.version },
      '127.0.0.1',
    );
    expect(acknowledged.actedAs).toEqual({
      role: 'ORG_OPERATOR',
      email: 'treklink.dev+operator@gmail.com',
    });
    const after = await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } });
    expect(after.state).toBe('ACKNOWLEDGED');
    const operator = await prisma.user.findUniqueOrThrow({
      where: { email: 'treklink.dev+operator@gmail.com' },
    });
    expect(after.ownerId).toBe(operator.id);
    expect(audits).toContainEqual(
      expect.objectContaining({
        action: 'demo.panel.incident-acknowledge',
        actorId: null,
        actorRoles: ['DEMO_PANEL'],
      }),
    );
  }, 60_000);
});
