import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AccountType, ContractStatus, IngressPath, PlanType, Prisma } from '@prisma/client';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { AccountsService } from '../src/modules/auth';
import { AccountsRepository } from '../src/modules/auth/accounts.repository';
import { DevicesRepository } from '../src/modules/devices/devices.repository';
import { DevicesService } from '../src/modules/devices/devices.service';
import { CanonicalEnvelope } from '../src/modules/gateway-sync/canonical-envelope';
import { IngestionRepository } from '../src/modules/gateway-sync/ingestion.repository';
import { IngestionService } from '../src/modules/gateway-sync/ingestion.service';
import { Normalizer } from '../src/modules/gateway-sync/normalizer/normalizer';
import { AlertDeliveriesRepository } from '../src/modules/incidents/alert-deliveries.repository';
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

// D-111 (TK-245, web#527), the TK-222 staging case: an SOS inside the attribution margin after a
// handover is stored Unattributed and its incident goes UNROUTED; the next SOS of the unit is
// attributed, joins the episode and routes it to that organization's primary. Real ingestion,
// routing, lifecycle and outbox on a migrated disposable Postgres. Unique fixtures, no deletes.
describe('an attributed SOS routes an UNROUTED episode, against Postgres (D-111)', () => {
  const prisma = new PrismaService({ datasourceUrl: databaseUrl });
  const emitter = new EventEmitter2();
  const events = new TransactionalEvents(prisma, emitter);
  const parameters = new ParameterService(
    new ParameterRepository(prisma),
    events,
    new ConfigService<ValidatedEnvironment, true>({ PARAMETER_CACHE_TTL_SECONDS: 0 }),
  );
  const repository = new IncidentsRepository(prisma);
  const lifecycle = new IncidentLifecycle(
    repository,
    new AlertDeliveriesRepository(),
    parameters,
    events,
  );
  const routing = new RoutingService(
    new RosterService(new RosterRepository(prisma)),
    new AccountsService(
      new AccountsRepository(prisma),
      {} as never,
      {} as never,
      events,
      {} as never,
    ),
  );
  const ingress = new IncidentIngress(repository, lifecycle, routing, parameters, events);
  const devices = new DevicesService(new DevicesRepository(prisma), {} as never, {} as never, {
    custodyAt: () => Promise.resolve(null),
  });
  const contracts = new ContractsService(
    new ContractsRepository(prisma),
    {} as never,
    {} as never,
    {} as never,
    events,
    devices,
    {} as never,
  );
  const ingestion = new IngestionService(
    new IngestionRepository(prisma),
    devices,
    contracts,
    ingress,
    new Normalizer(),
    parameters,
    events,
    {} as never, // FieldStationsService: this suite ingests node uplinks only
  );
  const runId = randomUUID();
  const audited = jest.fn();
  let packetId = Number.parseInt(randomUUID().slice(0, 7), 16);
  let organizationId: string;
  let operatorId: string;
  let managerId: string;
  let staffId: string;
  let variantId: string;
  let serial = 0;

  const user = async (name: string, accountType: AccountType) =>
    (
      await prisma.user.create({
        data: {
          email: `d111-${name}-${runId}@example.invalid`,
          fullName: `D111 ${name}`,
          accountType,
        },
      })
    ).id;

  // A custody interval of the device for `owner`, on a contract of its own (D-040).
  const custody = async (
    deviceId: string,
    owner: string,
    handedOverAt: Date,
    checkedInAt: Date | null = null,
  ) => {
    const contract = await prisma.rentalContract.create({
      data: {
        code: `RC-D111-${runId.slice(0, 8)}-${++serial}`,
        organizationId: owner,
        planType: PlanType.MONTHLY,
        hardwareVariantId: variantId,
        quantity: 1,
        requestedStartDate: new Date('2026-11-01T00:00:00Z'),
        monthlyUnitPriceVnd: 250_000n,
        holdingFeeRatio: new Prisma.Decimal('0.5'),
        requestedById: managerId,
        status: ContractStatus.ACTIVE,
      },
    });
    await prisma.contractDevice.create({
      data: {
        contractId: contract.id,
        deviceId,
        handedOverAt,
        checkedInAt,
        holderName: 'Le Thi E',
        holderPhone: '0912345678',
      },
    });
    return contract.id;
  };

  const unit = async () => {
    const nodeNum = Number.parseInt(randomUUID().slice(0, 7), 16);
    const device = await prisma.device.create({
      data: {
        assetTag: `D111-${runId.slice(0, 8)}-${++serial}`,
        nodeNum: BigInt(nodeNum),
        hardwareVariantId: variantId,
        firmwareVersion: 'test-only',
        acquiredAt: new Date(Date.now() - 86_400_000),
        registeredById: staffId,
        status: 'RENTED',
      },
    });
    return { nodeNum, deviceId: device.id };
  };

  // A unit handed over `handedOverSecondsAgo` before now to the test organization.
  const handedOverUnit = async (handedOverSecondsAgo: number) => {
    const { nodeNum, deviceId } = await unit();
    const handedOverAt = new Date(Date.now() - handedOverSecondsAgo * 1000);
    const contractId = await custody(deviceId, organizationId, handedOverAt);
    return { nodeNum, deviceId, contractId, handedOverAt };
  };

  // An SOS text of the node whose device clock reads `at`.
  const sos = (nodeNum: number, at: Date): CanonicalEnvelope => {
    packetId += 1;
    const message = {
      id: packetId,
      from: nodeNum,
      timestamp: Math.floor(at.getTime() / 1000),
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
    staffId = await user('staff', AccountType.TREKLINK);
    operatorId = await user('operator', AccountType.ORGANIZATION);
    managerId = await user('manager', AccountType.ORGANIZATION);
    variantId = (
      await prisma.hardwareVariant.create({
        data: {
          code: `d111-${runId}`,
          name: 'D111 variant',
          hasGps: true,
          hasMotionSensor: false,
          mqttCapable: true,
          firmwareBaseline: 'test-only',
          remainingValueSchedule: [],
        },
      })
    ).id;
    organizationId = (
      await prisma.organization.create({
        data: {
          code: `d111-${runId}`,
          legalName: 'D111 test organization',
          taxCode: runId,
          address: 'Test only',
          contactEmail: 'test@example.invalid',
          contactPhone: '0000000000',
          documentsSeen: [],
          status: 'ACTIVE',
        },
      })
    ).id;
    const [operator, manager] = await Promise.all(
      [
        [operatorId, 'OPERATOR'],
        [managerId, 'MANAGER'],
      ].map(([userId, role]) =>
        prisma.organizationMember.create({
          data: { userId, organizationId, role: role as 'OPERATOR' | 'MANAGER' },
        }),
      ),
    );
    await prisma.rosterShift.create({
      data: {
        organizationId,
        startsAt: new Date(Date.now() - 3 * 3600_000),
        endsAt: new Date(Date.now() + 3600_000),
        primaryMemberId: operator.id,
        backupMemberId: manager.id,
        createdById: managerId,
      },
    });
    emitter.on('audit.record', audited);
  });
  beforeEach(() => audited.mockClear());
  afterAll(async () => prisma.$disconnect());

  it('routes the episode on the next attributed SOS, once, with tier alerts and audit', async () => {
    const unit = await handedOverUnit(3600);
    // 1. An SOS 60 s after the handover, uploaded late: inside the margin, so Unattributed.
    const early = sos(unit.nodeNum, new Date(unit.handedOverAt.getTime() + 60_000));
    await expect(ingestion.ingest(early)).resolves.toBe('ACCEPTED_UNATTRIBUTED');
    const opened = await prisma.incident.findFirstOrThrow({ where: { deviceId: unit.deviceId } });
    expect(opened).toMatchObject({ state: 'UNROUTED', organizationId: null, contractId: null });

    // 2. The next SOS of the unit, now, well clear of the margin: attributed, it routes the episode.
    const next = sos(unit.nodeNum, new Date());
    await expect(ingestion.ingest(next)).resolves.toBe('ACCEPTED');
    const routed = await prisma.incident.findUniqueOrThrow({ where: { id: opened.id } });
    expect(routed).toMatchObject({
      state: 'NOTIFY_PRIMARY',
      organizationId,
      contractId: unit.contractId,
      ownerId: null,
      eventCount: 2,
      reopenCount: 0,
    });
    expect(routed.tierDeadlineAt).not.toBeNull();
    expect(await prisma.incident.count({ where: { deviceId: unit.deviceId } })).toBe(1);
    const transition = await prisma.incidentTransition.findFirstOrThrow({
      where: { incidentId: opened.id, fromState: 'UNROUTED' },
    });
    expect(transition).toMatchObject({
      toState: 'NOTIFY_PRIMARY',
      reason: 'ROUTED',
      actorId: null,
      seq: 3,
    });
    const rows = await prisma.alertDelivery.findMany({ where: { transitionId: transition.id } });
    expect(rows.map((row) => `${row.recipientId}:${row.tier}:${row.channel}`).sort()).toEqual([
      `${operatorId}:PRIMARY:EMAIL`,
      `${operatorId}:PRIMARY:WEB`,
      `${operatorId}:PRIMARY:WEBSOCKET`,
      'null:PRIMARY:API_EVENT',
    ]);
    const record = (audited.mock.calls as [{ subjectId: string; before?: { state?: string } }][])
      .map(([row]) => row)
      .find((row) => row.subjectId === opened.id && row.before?.state === 'UNROUTED');
    expect(record).toMatchObject({
      organizationId,
      after: { state: 'NOTIFY_PRIMARY', reason: 'ROUTED' },
    });

    // 3. A third attributed SOS appends only: no second routing.
    await expect(ingestion.ingest(sos(unit.nodeNum, new Date()))).resolves.toBe('ACCEPTED');
    expect(await prisma.incident.findUniqueOrThrow({ where: { id: opened.id } })).toMatchObject({
      state: 'NOTIFY_PRIMARY',
      eventCount: 3,
      version: routed.version,
    });
    expect(await prisma.incidentTransition.count({ where: { incidentId: opened.id } })).toBe(3);
  });

  // AC-09: A had nobody to alert, so A's episode is UNROUTED but still A's. After the unit is checked
  // in and handed to B, B's first SOS must not move A's open emergency to B or alert B's primary.
  it('keeps an UNROUTED episode of A with Staff when the next holder B sends an SOS', async () => {
    const nobodyOnDuty = (
      await prisma.organization.create({
        data: {
          code: `d111-a-${runId}`,
          legalName: 'D111 organization with no roster',
          taxCode: `a-${runId}`,
          address: 'Test only',
          contactEmail: 'test@example.invalid',
          contactPhone: '0000000000',
          documentsSeen: [],
          status: 'ACTIVE',
        },
      })
    ).id;
    const { nodeNum, deviceId } = await unit();
    const now = Date.now();
    const contractOfA = await custody(
      deviceId,
      nobodyOnDuty,
      new Date(now - 3600_000),
      new Date(now - 1800_000),
    );
    await custody(deviceId, organizationId, new Date(now - 1500_000));
    // 1. A's SOS, inside A's custody and clear of both margins, uploaded late: UNROUTED, kept on A.
    await expect(ingestion.ingest(sos(nodeNum, new Date(now - 3000_000)))).resolves.toBe(
      'ACCEPTED',
    );
    const opened = await prisma.incident.findFirstOrThrow({ where: { deviceId } });
    expect(opened).toMatchObject({
      state: 'UNROUTED',
      organizationId: nobodyOnDuty,
      contractId: contractOfA,
    });
    // 2. B's SOS, attributed to B: appended, the episode stays A's and UNROUTED.
    await expect(ingestion.ingest(sos(nodeNum, new Date()))).resolves.toBe('ACCEPTED');
    expect(await prisma.incident.findUniqueOrThrow({ where: { id: opened.id } })).toMatchObject({
      state: 'UNROUTED',
      organizationId: nobodyOnDuty,
      contractId: contractOfA,
      eventCount: 2,
      version: opened.version,
    });
    expect(await prisma.incident.count({ where: { deviceId } })).toBe(1);
    expect(await prisma.incidentTransition.count({ where: { incidentId: opened.id } })).toBe(2);
    expect(
      await prisma.alertDelivery.count({
        where: { incidentId: opened.id, recipientId: { in: [operatorId, managerId] } },
      }),
    ).toBe(0);
  });

  it('keeps the episode UNROUTED when the next SOS is Unattributed as well', async () => {
    const unit = await handedOverUnit(3600);
    const at = unit.handedOverAt.getTime();
    await ingestion.ingest(sos(unit.nodeNum, new Date(at + 60_000)));
    await expect(ingestion.ingest(sos(unit.nodeNum, new Date(at + 120_000)))).resolves.toBe(
      'ACCEPTED_UNATTRIBUTED',
    );
    const incident = await prisma.incident.findFirstOrThrow({ where: { deviceId: unit.deviceId } });
    expect(incident).toMatchObject({ state: 'UNROUTED', organizationId: null, eventCount: 2 });
    expect(await prisma.incidentTransition.count({ where: { incidentId: incident.id } })).toBe(2);
  });
});
