import { randomUUID } from 'node:crypto';
import {
  AccountType,
  AlertChannel,
  AlertStatus,
  IncidentConfidence,
  IncidentSource,
  IncidentState,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { AlertDeliveriesRepository } from '../src/modules/incidents/alert-deliveries.repository';
import { AuthorityReportsRepository } from '../src/modules/incidents/authority-reports.repository';
import { IncidentsRepository, NewIncident } from '../src/modules/incidents/incidents.repository';

// Capture explicit connection settings before Prisma can load a local .env at construction.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !process.env.DATABASE_DIRECT_URL) {
  throw new Error('test:db requires explicit DATABASE_URL and DATABASE_DIRECT_URL.');
}

// Run only through test:db against a migrated disposable database. Never deletes data.
// Fixtures carry a fresh run ID; the local container or CI service is discarded after verification.
describe('incident foundation against Postgres (REQ-UBI-02, BR-13)', () => {
  const prisma = new PrismaService({ datasourceUrl: databaseUrl });
  const repository = new IncidentsRepository();
  const alerts = new AlertDeliveriesRepository();
  const reports = new AuthorityReportsRepository();
  const at = new Date('2026-10-23T09:00:00Z');
  const runId = randomUUID();
  let staffId: string;
  let variantId: string;
  let serial = 0;

  const input = (deviceId: string): NewIncident => ({
    deviceId,
    source: IncidentSource.DEVICE_SOS,
    confidence: IncidentConfidence.CONFIRMED,
    firstEventAt: at,
    lastEventAt: at,
  });

  const device = async () => {
    serial += 1;
    return prisma.device.create({
      data: {
        assetTag: `incident-test-${runId}-${serial}`,
        // Random 32-bit test radio identity.
        nodeNum: BigInt(`0x${randomUUID().slice(0, 8)}`),
        hardwareVariantId: variantId,
        firmwareVersion: 'test-only',
        acquiredAt: at,
        registeredById: staffId,
      },
    });
  };

  beforeAll(async () => {
    await prisma.$connect();
    staffId = (
      await prisma.user.create({
        data: {
          email: `incident-test-${runId}@example.invalid`,
          fullName: 'Incident test staff',
          accountType: AccountType.TREKLINK,
        },
      })
    ).id;
    variantId = (
      await prisma.hardwareVariant.create({
        data: {
          code: `incident-test-${runId}`,
          name: 'Incident test variant',
          hasGps: true,
          hasMotionSensor: false,
          mqttCapable: true,
          firmwareBaseline: 'test-only',
          remainingValueSchedule: [],
        },
      })
    ).id;
  });

  afterAll(async () => prisma.$disconnect());

  it('ten concurrent inserts correlate to exactly one open incident', async () => {
    const { id } = await device();
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        prisma.$transaction((tx) => repository.insert(input(id), at, tx), {
          maxWait: 15000,
          timeout: 15000,
        }),
      ),
    );
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result.incident.id)).size).toBe(1);
    expect(await prisma.incident.count({ where: { deviceId: id } })).toBe(1);
  });

  it('allocates unique six-digit codes for concurrent different devices', async () => {
    const devices = await Promise.all(Array.from({ length: 10 }, () => device()));
    const results = await Promise.all(
      devices.map(({ id }) =>
        prisma.$transaction((tx) => repository.insert(input(id), at, tx), {
          maxWait: 15000,
          timeout: 15000,
        }),
      ),
    );
    expect(results.every((result) => result.created)).toBe(true);
    expect(new Set(results.map((result) => result.incident.code)).size).toBe(10);
    for (const result of results) expect(result.incident.code).toMatch(/^INC-2026-\d{6}$/);
  });

  it.each(Object.values(IncidentState).filter((state) => state !== IncidentState.CLOSED))(
    'correlates to an existing %s incident and keeps its transaction usable',
    async (state) => {
      const { id } = await device();
      const original = await prisma.incident.create({
        data: { ...input(id), code: `fixture-${runId}-${state}`, state },
      });
      await prisma.$transaction(async (tx) => {
        const result = await repository.insert(input(id), at, tx);
        expect(result).toEqual({ incident: original, created: false });
        const report = await reports.insert(
          {
            incidentId: result.incident.id,
            agency: 'Test authority',
            reference: `test-${state}`,
            reportedAt: at,
            reportedById: staffId,
          },
          tx,
        );
        expect(await tx.authorityReport.findUnique({ where: { id: report.id } })).not.toBeNull();
      });
      expect(await prisma.authorityReport.count({ where: { incidentId: original.id } })).toBe(1);
    },
  );

  it('allows another incident after CLOSED and does not lock the closed row as open', async () => {
    const { id } = await device();
    await prisma.incident.create({
      data: { ...input(id), code: `fixture-${runId}-closed`, state: IncidentState.CLOSED },
    });
    await prisma.$transaction(async (tx) => {
      expect(await repository.lockOpenByDevice(id, tx)).toBeNull();
      const result = await repository.insert(input(id), at, tx);
      expect(result.created).toBe(true);
      expect(await repository.lockOpenByDevice(id, tx)).toEqual(result.incident);
    });
    expect(await prisma.incident.count({ where: { deviceId: id } })).toBe(2);
  });

  it('rolls back incident, transition, outbox and authority report together', async () => {
    const { id } = await device();
    const aborted = new Error('test rollback');
    let incidentId = '';
    await expect(
      prisma.$transaction(async (tx) => {
        const result = await repository.insert(input(id), at, tx);
        incidentId = result.incident.id;
        const transition = await tx.incidentTransition.create({
          data: { incidentId, seq: 1, toState: IncidentState.DETECTED, reason: 'CREATED' },
        });
        await alerts.enqueue(
          [
            {
              incidentId,
              transitionId: transition.id,
              tier: 'TREKLINK',
              recipientId: staffId,
              channel: AlertChannel.WEB,
            },
          ],
          tx,
        );
        await reports.insert(
          {
            incidentId,
            agency: 'Test authority',
            reference: 'rollback',
            reportedAt: at,
            reportedById: staffId,
          },
          tx,
        );
        expect(await tx.alertDelivery.count({ where: { incidentId } })).toBe(1);
        throw aborted;
      }),
    ).rejects.toBe(aborted);
    expect(await prisma.incident.findUnique({ where: { id: incidentId } })).toBeNull();
    expect(await prisma.incidentTransition.count({ where: { incidentId } })).toBe(0);
    expect(await prisma.alertDelivery.count({ where: { incidentId } })).toBe(0);
    expect(await prisma.authorityReport.count({ where: { incidentId } })).toBe(0);
  });

  it('persists a pending API outbox row with schema defaults on commit', async () => {
    const { id } = await device();
    const incidentId = await prisma.$transaction(async (tx) => {
      const { incident } = await repository.insert(input(id), at, tx);
      const transition = await tx.incidentTransition.create({
        data: {
          incidentId: incident.id,
          seq: 1,
          toState: IncidentState.DETECTED,
          reason: 'CREATED',
        },
      });
      await alerts.enqueue(
        [
          {
            incidentId: incident.id,
            transitionId: transition.id,
            tier: 'TREKLINK',
            recipientId: null,
            channel: AlertChannel.API_EVENT,
          },
        ],
        tx,
      );
      return incident.id;
    });
    const row = await prisma.alertDelivery.findFirstOrThrow({ where: { incidentId } });
    expect(row).toMatchObject({ status: AlertStatus.PENDING, attempts: 0, sentAt: null });
    expect(row.nextAttemptAt).toBeInstanceOf(Date);
  });

  it('preserves a foreign-key error and restores the savepoint before subsequent writes', async () => {
    const { id } = await device();
    await prisma.$transaction(async (tx) => {
      await expect(repository.insert(input(randomUUID()), at, tx)).rejects.toMatchObject({
        code: 'P2003',
      } satisfies Partial<Prisma.PrismaClientKnownRequestError>);
      expect((await repository.insert(input(id), at, tx)).created).toBe(true);
    });
  });
});
