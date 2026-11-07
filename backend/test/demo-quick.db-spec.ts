import './db-app-env';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { seedDemo } from '../prisma/seed-demo';
import { DemoQuickService } from '../src/modules/demo/demo-quick.service';
import { DemoSessionService } from '../src/modules/auth';
import { AUDIT_RECORD, AuditRecordEvent } from '../src/modules/platform/audit/audit-record.event';

const baseUrl = process.env.DATABASE_URL;
if (
  !baseUrl ||
  !process.env.DATABASE_DIRECT_URL ||
  !['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseUrl).hostname)
)
  throw new Error('W43 db-spec requires an explicit disposable loopback Postgres.');
process.env.DEMO_CONTROLS_ENABLED = 'true';
process.env.VITE_APP_ENV = 'staging';
process.env.DEMO_SIMULATION_ENABLED = 'true';

// Isolated schema on a disposable local database only. No shared database is reset or seeded.
describe('W43 additive scenarios on Postgres', () => {
  const schema = `w43_${randomUUID().replaceAll('-', '')}`;
  const url = new URL(baseUrl);
  url.searchParams.set('schema', schema);
  const prisma = new PrismaService({ datasourceUrl: url.toString() });
  let module: TestingModule;
  let quick: DemoQuickService;
  let actor: { id: string; roles: string[]; organizationId: null };
  let contractId: string;
  let deviceId: string;
  let incidentId: string;
  const audits: AuditRecordEvent[] = [];

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
    await seedDemo(
      prisma,
      {
        admin: 'Local-w43-test-1',
        staff: 'Local-w43-test-1',
        manager: 'Local-w43-test-1',
        operator: 'Local-w43-test-1',
      },
      { now: new Date(Date.now() - 3600000), bcryptCost: 4 },
    );
    const { AppModule } = await import('../src/app.module');
    module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    quick = module.get(DemoQuickService, { strict: false });
    actor = {
      id: (await prisma.user.findUniqueOrThrow({ where: { email: 'admin@treklink.local' } })).id,
      roles: ['ADMIN'],
      organizationId: null,
    };
    module.get(EventEmitter2).on(AUDIT_RECORD, (event: AuditRecordEvent) => audits.push(event));
  }, 120000);
  afterAll(async () => {
    await module?.close();
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await prisma.$disconnect();
  });

  it('creates a fresh multi-unit ACTIVE contract with normal invoice, receipt, provisioning and signed note', async () => {
    const options = await quick.options(actor);
    const originalContracts = await prisma.rentalContract.count();
    const result = await quick.run(
      'contract',
      {
        organizationId: options.organizations[0].id,
        hardwareVariantId: options.variants.find((v) => v.code === 'treklink-v3')!.id,
        quantity: options.minimumQuantity,
        target: 'ACTIVE',
      },
      actor,
    );
    expect(result.error).toBeNull();
    contractId = result.records[0].path.split('/').at(-1)!;
    const contract = await prisma.rentalContract.findUniqueOrThrow({
      where: { id: contractId },
      include: { devices: true },
    });
    expect(contract.status).toBe('ACTIVE');
    expect(contract.devices.length).toBeGreaterThanOrEqual(2);
    expect(await prisma.rentalContract.count()).toBe(originalContracts + 1);
    expect(contract.handoverNotePath).toBeTruthy();
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { contractId } });
    expect(await prisma.payment.count({ where: { invoiceId: invoice.id } })).toBeGreaterThan(0);
    expect(audits).toContainEqual(
      expect.objectContaining({ action: 'demo.quick.contract', actorId: actor.id }),
    );
    expect(
      await prisma.demoScenarioRun.findUniqueOrThrow({ where: { id: result.runId } }),
    ).toMatchObject({ actorId: actor.id, error: null });
    deviceId = contract.devices[0].deviceId;
  });

  it('ingests a fresh rented-node SOS, persists simulated provenance, real routing and alert outbox', async () => {
    const result = await quick.run('incident', { deviceId }, actor);
    expect(result.error).toBeNull();
    incidentId = result.records[0].path.split('/').at(-1)!;
    const incident = await prisma.incident.findUniqueOrThrow({ where: { id: incidentId } });
    expect(incident.simulated).toBe(true);
    expect(incident.contractId).toBe(contractId);
    expect(incident.state).toBe('NOTIFY_PRIMARY');
    expect(await prisma.alertDelivery.count({ where: { incidentId } })).toBeGreaterThan(0);
    expect(audits).toContainEqual(
      expect.objectContaining({ action: 'demo.quick.incident', actorId: actor.id }),
    );
    await expect(quick.run('incident', { deviceId }, actor)).rejects.toMatchObject({
      httpStatus: 409,
      errorCode: 'DEMO_SCENARIO_UNAVAILABLE',
    });
    expect(await prisma.incident.count({ where: { deviceId, state: { not: 'CLOSED' } } })).toBe(1);
  });

  it('advances only the chosen simulated incident and refuses its stale version', async () => {
    const before = await prisma.incident.findUniqueOrThrow({ where: { id: incidentId } });
    expect(
      (
        await quick.run(
          'next-tier',
          { recordId: incidentId, expectedVersion: before.version },
          actor,
        )
      ).error,
    ).toBeNull();
    const after = await prisma.incident.findUniqueOrThrow({ where: { id: incidentId } });
    expect(after.state).not.toBe(before.state);
    expect(after.version).toBeGreaterThan(before.version);
    await expect(
      quick.run('next-tier', { recordId: incidentId, expectedVersion: before.version }, actor),
    ).rejects.toMatchObject({ httpStatus: 409, errorCode: 'STALE_VERSION' });
  });

  it('restores the four escalation parameters from its durable snapshot', async () => {
    const before = await prisma.businessParameter.findMany({
      where: {
        key: {
          in: [
            'incidents.primaryAckTimeoutSeconds',
            'incidents.backupAckTimeoutSeconds',
            'incidents.managerAckTimeoutSeconds',
            'incidents.reopenWindowMinutes',
          ],
        },
      },
      orderBy: { key: 'asc' },
    });
    const options = await quick.options(actor);
    expect(
      (
        await quick.run(
          'profile',
          { active: true, expectedVersion: options.profile.version },
          actor,
        )
      ).error,
    ).toBeNull();
    expect((await quick.options(actor)).profile.active).toBe(true);
    expect(
      (
        await quick.run(
          'profile',
          { active: false, expectedVersion: options.profile.version + 1 },
          actor,
        )
      ).error,
    ).toBeNull();
    const after = await prisma.businessParameter.findMany({
      where: { key: { in: before.map((p) => p.key) } },
      orderBy: { key: 'asc' },
    });
    expect(after.map((p) => p.value)).toEqual(before.map((p) => p.value));
  });

  it('can shift one contract to RETURN_DUE without rolling unrelated terms', async () => {
    const before = await prisma.rentalContract.findUniqueOrThrow({ where: { id: contractId } });
    const unrelated = await prisma.contractTerm.findMany({
      where: { contractId: { not: contractId } },
    });
    const result = await quick.run(
      'term-end',
      { recordId: contractId, expectedVersion: before.version },
      actor,
    );
    expect(result.error).toBeNull();
    expect(
      (await prisma.rentalContract.findUniqueOrThrow({ where: { id: contractId } })).status,
    ).toBe('RETURN_DUE');
    expect(
      await prisma.contractTerm.findMany({ where: { contractId: { not: contractId } } }),
    ).toEqual(unrelated);
  });

  it('still refuses password-free role switching in production and non-Admin quick writes', async () => {
    module.get(ConfigService).set('NODE_ENV', 'production');
    await expect(
      module
        .get(DemoSessionService)
        .switchTo('staff@treklink.local', { ip: null, userAgent: null }),
    ).rejects.toMatchObject({ errorCode: 'DEMO_DISABLED' });
    await expect(
      quick.run('organization', {}, { ...actor, roles: ['STAFF'] }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
