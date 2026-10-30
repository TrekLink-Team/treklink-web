import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AccountType, IngressPath } from '@prisma/client';
import { Caller } from '../src/common/decorators/access.decorator';
import { ErrorCode } from '../src/common/errors';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { DevicesRepository } from '../src/modules/devices/devices.repository';
import { DevicesService } from '../src/modules/devices/devices.service';
import { CanonicalEnvelope } from '../src/modules/gateway-sync/canonical-envelope';
import { IngestionRepository } from '../src/modules/gateway-sync/ingestion.repository';
import { IngestionService } from '../src/modules/gateway-sync/ingestion.service';
import { Normalizer } from '../src/modules/gateway-sync/normalizer/normalizer';
import { AlertDeliveriesRepository } from '../src/modules/incidents/alert-deliveries.repository';
import { AuthorityReportsRepository } from '../src/modules/incidents/authority-reports.repository';
import { AuthorityReportsService } from '../src/modules/incidents/authority-reports.service';
import { IncidentIngress } from '../src/modules/incidents/incident-ingress';
import { IncidentLifecycle } from '../src/modules/incidents/incident-lifecycle';
import { IncidentsRepository } from '../src/modules/incidents/incidents.repository';
import { RoutingService } from '../src/modules/incidents/routing.service';
import { RosterRepository } from '../src/modules/organizations/roster.repository';
import { RosterService } from '../src/modules/organizations/roster.service';
import { ValidatedEnvironment } from '../src/modules/platform/config/environment-variables';
import { TransactionalEvents } from '../src/modules/platform/events/emit-after-commit';
import { ParameterRepository } from '../src/modules/platform/parameters/parameter.repository';
import { ParameterService } from '../src/modules/platform/parameters/parameter.service';
import { ContractsRepository } from '../src/modules/rentals/contracts.repository';
import { ContractsService } from '../src/modules/rentals/contracts.service';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !process.env.DATABASE_DIRECT_URL) {
  throw new Error('test:db requires explicit DATABASE_URL and DATABASE_DIRECT_URL.');
}

// Incidents AC-04 (TC-17) against Postgres: an SOS from a device on no contract is UNROUTED; Staff
// record an authority report, then the case closed; the incident ends CLOSED. Run only through
// test:db on a migrated disposable database. Fixtures carry a fresh run ID; nothing is deleted.
describe('AC-04, an unrouted SOS reported to the authorities, against Postgres', () => {
  const prisma = new PrismaService({ datasourceUrl: databaseUrl });
  const emitter = new EventEmitter2();
  const events = new TransactionalEvents(prisma, emitter);
  const config = new ConfigService<ValidatedEnvironment, true>({
    PARAMETER_CACHE_TTL_SECONDS: 0,
    DEFAULT_PAGE_SIZE: 20,
    MAX_PAGE_SIZE: 100,
  });
  const parameters = new ParameterService(new ParameterRepository(prisma), events, config);
  const incidentsRepository = new IncidentsRepository(prisma);
  const lifecycle = new IncidentLifecycle(
    incidentsRepository,
    new AlertDeliveriesRepository(),
    parameters,
    events,
  );
  const ingress = new IncidentIngress(
    incidentsRepository,
    lifecycle,
    new RoutingService(new RosterService(new RosterRepository(prisma)), {} as never),
    parameters,
    events,
  );
  const contracts = new ContractsService(
    new ContractsRepository(prisma),
    {} as never,
    {} as never,
    {} as never,
    events,
    {} as never,
  );
  const ingestion = new IngestionService(
    new IngestionRepository(prisma),
    new DevicesService(new DevicesRepository(prisma), {} as never, {} as never),
    contracts,
    ingress,
    new Normalizer(),
    parameters,
    events,
  );
  const reports = new AuthorityReportsService(
    incidentsRepository,
    new AuthorityReportsRepository(prisma),
    lifecycle,
    events,
    config,
    contracts,
  );
  const runId = randomUUID();
  const nodeNum = Number.parseInt(randomUUID().slice(0, 7), 16);
  const packetId = Number.parseInt(randomUUID().slice(0, 7), 16);
  let staff: Caller;
  let deviceId: string;

  // A stock text SOS (TrekLinkSOSHelper.h:19), received now.
  const sos = (): CanonicalEnvelope => {
    const message = {
      id: packetId,
      from: nodeNum,
      timestamp: Math.floor(Date.now() / 1000),
      type: 'text' as const,
      sender: `!${nodeNum.toString(16)}`,
      payload: { text: 'SOS - [11.561000], [108.552000]' },
    };
    return {
      ingress: IngressPath.MQTT_NODE,
      uplinkKey: message.sender,
      receivedAt: new Date(),
      packet: message,
      message,
    };
  };

  beforeAll(async () => {
    await prisma.$connect();
    const staffRow = await prisma.user.create({
      data: {
        email: `ac04-staff-${runId}@example.invalid`,
        fullName: 'AC04 staff',
        accountType: AccountType.TREKLINK,
      },
    });
    staff = { id: staffRow.id, roles: ['STAFF'], organizationId: null };
    const variant = await prisma.hardwareVariant.create({
      data: {
        code: `ac04-${runId}`,
        name: 'AC04 variant',
        hasGps: true,
        hasMotionSensor: false,
        mqttCapable: true,
        firmwareBaseline: 'test-only',
        remainingValueSchedule: [],
      },
    });
    // In stock and on no contract, so its SOS is unattributed (D-040).
    deviceId = (
      await prisma.device.create({
        data: {
          assetTag: `AC04-${runId.slice(0, 8)}`,
          nodeNum: BigInt(nodeNum),
          hardwareVariantId: variant.id,
          firmwareVersion: 'test-only',
          acquiredAt: new Date(Date.now() - 86_400_000),
          registeredById: staffRow.id,
          status: 'AVAILABLE',
        },
      })
    ).id;
  });

  afterAll(async () => prisma.$disconnect());

  it('runs AC-04 end to end and refuses a second closure', async () => {
    // 1. The SOS is stored unattributed and opens an incident with no route.
    await expect(ingestion.ingest(sos())).resolves.toBe('ACCEPTED_UNATTRIBUTED');
    const incident = await prisma.incident.findFirstOrThrow({ where: { deviceId } });
    expect(incident).toMatchObject({ state: 'UNROUTED', organizationId: null, contractId: null });

    // 2. A stale version is refused and writes no report.
    await expect(
      reports.reportIncident(
        incident.id,
        {
          agency: 'Lam Dong provincial rescue (114)',
          reference: `LD-114-${runId.slice(0, 6)}`,
          reportedAt: new Date(Date.now() - 60_000),
          expectedVersion: incident.version - 1,
        },
        staff,
      ),
    ).rejects.toMatchObject({ errorCode: ErrorCode.STALE_VERSION });
    expect(await prisma.authorityReport.count({ where: { incidentId: incident.id } })).toBe(0);

    // 3. Staff record the report: the incident is REPORTED and the report row is written with it.
    const reportedAt = new Date(Date.now() - 60_000);
    const reported = await reports.reportIncident(
      incident.id,
      {
        agency: 'Lam Dong provincial rescue (114)',
        reference: `LD-114-${runId.slice(0, 6)}`,
        reportedAt,
        note: 'Last position shared by phone.',
        expectedVersion: incident.version,
      },
      staff,
    );
    expect(reported).toMatchObject({ state: 'REPORTED', version: incident.version + 1 });
    const report = await prisma.authorityReport.findFirstOrThrow({
      where: { incidentId: incident.id },
    });
    expect(report).toMatchObject({
      reportedById: staff.id,
      reportedAt,
      caseClosedAt: null,
      contractId: null,
    });

    // 4. The open case is listed first.
    const listed = await reports.list({ open: true, pageSize: 100 });
    expect(listed.items.map((row) => row.id)).toContain(report.id);

    // 5. Staff record the case closed: the incident ends CLOSED.
    const closedAt = new Date(Date.now() - 1000);
    await expect(reports.closeCase(report.id, { closedAt }, staff)).resolves.toEqual({
      id: report.id,
      caseClosedAt: closedAt,
      incidentState: 'CLOSED',
    });
    const closed = await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } });
    expect(closed.state).toBe('CLOSED');
    expect(closed.closedAt).not.toBeNull();
    expect(
      await prisma.authorityReport.findUniqueOrThrow({ where: { id: report.id } }),
    ).toMatchObject({ caseClosedAt: closedAt, caseClosedById: staff.id });

    // 6. The trail records both Staff transitions, and neither alerted a person.
    const transitions = await prisma.incidentTransition.findMany({
      where: { incidentId: incident.id },
      orderBy: { seq: 'asc' },
    });
    expect(transitions.slice(-2).map((t) => [t.fromState, t.toState, t.reason, t.actorId])).toEqual(
      [
        ['UNROUTED', 'REPORTED', 'AUTHORITY_REPORTED', staff.id],
        ['REPORTED', 'CLOSED', 'CASE_CLOSED', staff.id],
      ],
    );
    const staffTransitionIds = transitions.slice(-2).map((t) => t.id);
    expect(
      await prisma.alertDelivery.count({ where: { transitionId: { in: staffTransitionIds } } }),
    ).toBe(0);

    // 7. A second closure is refused and keeps the first time.
    await expect(
      reports.closeCase(report.id, { closedAt: new Date() }, staff),
    ).rejects.toMatchObject({ errorCode: ErrorCode.CASE_ALREADY_CLOSED });
    expect(
      (await prisma.authorityReport.findUniqueOrThrow({ where: { id: report.id } })).caseClosedAt,
    ).toEqual(closedAt);
  });

  // PR #137 review: an incident reported twice (again after a reopen) holds two open reports. Closing
  // the first keeps the incident REPORTED; closing the second, the last open one, moves it to CLOSED.
  it('closes the incident only when the last open report on it closes', async () => {
    const at = new Date(Date.now() - 120_000);
    const device = await prisma.device.findUniqueOrThrow({ where: { id: deviceId } });
    const second = await prisma.device.create({
      data: {
        assetTag: `AC04B-${runId.slice(0, 8)}`,
        nodeNum: BigInt(nodeNum) + 1n,
        hardwareVariantId: device.hardwareVariantId,
        firmwareVersion: 'test-only',
        acquiredAt: new Date(Date.now() - 86_400_000),
        registeredById: staff.id,
        status: 'AVAILABLE',
      },
    });
    const incident = await prisma.incident.create({
      data: {
        code: `INC-T-${runId.slice(0, 8)}`,
        deviceId: second.id,
        state: 'REPORTED',
        stateChangedAt: at,
        source: 'DEVICE_SOS',
        confidence: 'CONFIRMED',
        firstEventAt: at,
        lastEventAt: at,
        version: 3,
      },
    });
    const open = (reference: string) =>
      prisma.authorityReport.create({
        data: {
          incidentId: incident.id,
          agency: 'Lam Dong provincial rescue (114)',
          reference,
          reportedAt: at,
          reportedById: staff.id,
        },
      });
    const first = await open(`LD-A-${runId.slice(0, 6)}`);
    const last = await open(`LD-B-${runId.slice(0, 6)}`);

    await expect(
      reports.closeCase(first.id, { closedAt: new Date(Date.now() - 2000) }, staff),
    ).resolves.toMatchObject({ incidentState: 'REPORTED' });
    expect((await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } })).state).toBe(
      'REPORTED',
    );

    await expect(
      reports.closeCase(last.id, { closedAt: new Date(Date.now() - 1000) }, staff),
    ).resolves.toMatchObject({ incidentState: 'CLOSED' });
    expect((await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } })).state).toBe(
      'CLOSED',
    );
  });
});
