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
  throw new Error('demo-controls.db-spec resets the database; never run it against Neon.');
}

// The demo module is loaded only with the flag (REQ-UBI-01); AppModule reads it when it is compiled.
process.env.DEMO_CONTROLS_ENABLED = 'true';
const PASSWORD = 'Demo-controls-1';
for (const role of ['ADMIN', 'STAFF', 'MANAGER', 'OPERATOR']) {
  process.env[`SEED_${role}_PASSWORD`] = PASSWORD;
}
process.env.BCRYPT_COST = '4';

// specs/demo AC-03: three stages in a row on Postgres, each checked through its key records. A stage
// truncates every data table, so the suite runs in a schema of its own on the disposable database
// (as seed-demo-history.db-spec does), migrated here and dropped at the end.
describe('demo control panel stages on Postgres', () => {
  const schema = `demo_controls_${randomUUID().slice(0, 8)}`;
  const url = new URL(databaseUrl);
  url.searchParams.set('schema', schema);
  const prisma = new PrismaService({ datasourceUrl: url.toString() });
  let close: () => Promise<void>;

  let scenarios: import('../src/modules/demo/demo-scenarios.service').DemoScenariosService;
  const audits: AuditRecordEvent[] = [];
  const client = { ip: '127.0.0.1', userAgent: 'demo-controls.db-spec' };

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
    const { AppModule } = await import('../src/app.module');
    const { DemoScenariosService } = await import('../src/modules/demo/demo-scenarios.service');
    // Compiled, not started: no scheduler job runs beside the stage.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    close = () => moduleRef.close();
    scenarios = moduleRef.get(DemoScenariosService, { strict: false });
    // Compiled without init, the audit sink does not listen; the stage's audit event is caught here.
    moduleRef.get(EventEmitter2).on(AUDIT_RECORD, (event: AuditRecordEvent) => audits.push(event));
  }, 120_000);
  afterAll(async () => {
    await close?.();
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await prisma.$disconnect();
  });

  const statusOf = async (code: string) =>
    (await prisma.rentalContract.findUniqueOrThrow({ where: { code } })).status;

  it('stages clean: the seed only, ORG-0002 and RC-2026-0004 not taken', async () => {
    const result = await scenarios.stage('clean', client);
    expect(result.records.map((r) => r.code)).toEqual([
      'RC-2026-0001',
      'RC-2026-0002',
      'RC-2026-0003',
    ]);
    expect(result.session.user.email).toBe('admin@treklink.local');
    expect(result.session.accessToken).toEqual(expect.any(String));
    expect(await statusOf('RC-2026-0001')).toBe('ACTIVE');
    expect(await statusOf('RC-2026-0003')).toBe('DEFAULTED');
    expect(await prisma.organization.count()).toBe(1);
    expect(await prisma.rentalContract.count()).toBe(3);
    // The reference tables survive the reset.
    expect(await prisma.permission.count({ where: { key: 'demo.stage' } })).toBe(1);
    expect(await prisma.businessParameter.count()).toBeGreaterThan(40);
  }, 120_000);

  it('stages contract-ready-for-handover: RC-2026-0004 approved, five v3 reserved, holding fee paid', async () => {
    const result = await scenarios.stage('contract-ready-for-handover', client);
    const contract = await prisma.rentalContract.findUniqueOrThrow({
      where: { code: 'RC-2026-0004' },
      include: { devices: { include: { device: { include: { hardwareVariant: true } } } } },
    });
    expect(contract.status).toBe('APPROVED');
    expect(contract.devices).toHaveLength(5);
    for (const row of contract.devices) {
      expect(row.device.status).toBe('RESERVED');
      expect(row.device.hardwareVariant.code).toBe('treklink-v3');
    }
    const holding = await prisma.invoiceLine.findFirstOrThrow({
      where: { invoice: { contractId: contract.id }, type: 'HOLDING_FEE' },
    });
    expect(holding.paidVnd).toBe(holding.amountVnd);
    expect(result.records).toContainEqual({
      label: 'Counter handover',
      code: 'RC-2026-0004',
      path: `/t/counter/${contract.id}`,
    });
    // One generic audit event for the stage, emitted after the reset by the new Admin.
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@treklink.local' } });
    expect(audits.filter((a) => a.subjectId === 'contract-ready-for-handover')).toEqual([
      expect.objectContaining({
        action: 'demo.stage',
        actorId: admin.id,
        subjectType: 'DemoScenario',
      }),
    ]);
  }, 120_000);

  it('stages term-ended: RC-2026-0002 RETURN_DUE, and the earlier RC-2026-0004 is gone', async () => {
    await scenarios.stage('term-ended', client);
    expect(await statusOf('RC-2026-0002')).toBe('RETURN_DUE');
    expect(await prisma.rentalContract.findUnique({ where: { code: 'RC-2026-0004' } })).toBeNull();
    expect(scenarios.status().lastStaged?.scenarioId).toBe('term-ended');
  }, 120_000);

  it('stages org-pending-approval, sos-open and asset-maintenance through the owning services', async () => {
    const pending = await scenarios.stage('org-pending-approval', client);
    expect(pending.records[0].code).toBe('ORG-0002');
    expect(
      (await prisma.organization.findUniqueOrThrow({ where: { code: 'ORG-0002' } })).status,
    ).toBe('PENDING');

    const sos = await scenarios.stage('sos-open', client);
    const incident = await prisma.incident.findUniqueOrThrow({
      where: { code: sos.records[0].code },
      include: { device: true },
    });
    expect(incident.device.assetTag).toBe('TL-0010');
    // Routed to the Operator's organization, not left UNROUTED inside the attribution margin.
    expect(incident.state).not.toBe('UNROUTED');
    expect(incident.organizationId).not.toBeNull();

    await scenarios.stage('asset-maintenance', client);
    const tl7 = await prisma.device.findUniqueOrThrow({ where: { assetTag: 'TL-0007' } });
    expect(tl7.status).toBe('MAINTENANCE');
    expect(
      await prisma.maintenanceRecord.count({ where: { deviceId: tl7.id, status: 'OPEN' } }),
    ).toBe(1);
    const tl2 = await prisma.device.findUniqueOrThrow({ where: { assetTag: 'TL-0002' } });
    expect(tl2.serviceDueAt).not.toBeNull();
  }, 120_000);
});
