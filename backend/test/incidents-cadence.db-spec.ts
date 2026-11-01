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

// Incidents REQ-EVT-02 against Postgres: a burst of positions with no open incident opens exactly
// one SUSPECTED incident from CADENCE_INFERRED inside ingestion, routed and alerted as at creation;
// later positions join it, a later SOS upgrades it in place, a burst delivered concurrently still
// opens one, and the positions of a closed episode never open a second. Run only through test:db on
// a migrated disposable database.
describe('Cadence-inferred incident (incidents REQ-EVT-02), against Postgres', () => {
  const prisma = new PrismaService({ datasourceUrl: databaseUrl });
  const emitter = new EventEmitter2();
  const events = new TransactionalEvents(prisma, emitter);
  const parameters = new ParameterService(
    new ParameterRepository(prisma),
    events,
    new ConfigService<ValidatedEnvironment, true>({ PARAMETER_CACHE_TTL_SECONDS: 0 }),
  );
  const incidentsRepository = new IncidentsRepository(prisma);
  const lifecycle = new IncidentLifecycle(
    incidentsRepository,
    new AlertDeliveriesRepository(),
    parameters,
    events,
  );
  const accounts = new AccountsService(
    new AccountsRepository(prisma),
    {} as never,
    {} as never,
    events,
    {} as never,
  );
  const ingress = new IncidentIngress(
    incidentsRepository,
    lifecycle,
    new RoutingService(new RosterService(new RosterRepository(prisma)), accounts),
    parameters,
    events,
  );
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
  let packetId = Number.parseInt(randomUUID().slice(0, 7), 16);
  let organizationId: string;
  let operatorId: string;
  let count: number;
  let windowSeconds: number;
  const nodes: { nodeNum: number; deviceId: string }[] = [];

  // A stock position packet of the node, its device time `secondsAgo` before now, so every
  // occurrence time stays plausible (gatewaySync.deviceTimeMaxAheadSeconds) and in order.
  const fix = (nodeNum: number, secondsAgo: number): CanonicalEnvelope => {
    packetId += 1;
    const time = Math.floor(Date.now() / 1000) - secondsAgo;
    const message = {
      id: packetId,
      from: nodeNum,
      timestamp: time,
      type: 'position' as const,
      sender: `!${nodeNum.toString(16)}`,
      payload: { time, latitude_i: 115544000, longitude_i: 1085381000, altitude: 1320 },
    };
    return {
      ingress: IngressPath.MQTT_NODE,
      uplinkKey: message.sender,
      receivedAt: new Date(),
      packet: message,
      message,
    };
  };

  const sos = (nodeNum: number): CanonicalEnvelope => {
    packetId += 1;
    const message = {
      id: packetId,
      from: nodeNum,
      timestamp: Math.floor(Date.now() / 1000),
      type: 'text' as const,
      sender: `!${nodeNum.toString(16)}`,
      payload: { text: 'SOS - [11.554400], [108.538100]' },
    };
    return {
      ingress: IngressPath.MQTT_NODE,
      uplinkKey: message.sender,
      receivedAt: new Date(),
      packet: message,
      message,
    };
  };

  // `count` positions spread evenly over the window, the last one `endSecondsAgo` before now.
  const burst = (nodeNum: number, endSecondsAgo: number) =>
    Array.from({ length: count }, (_, i) =>
      fix(
        nodeNum,
        endSecondsAgo + Math.floor(((count - 1 - i) * (windowSeconds - 1)) / (count - 1)),
      ),
    );

  const incidentsOf = (deviceId: string) =>
    prisma.incident.findMany({ where: { deviceId }, orderBy: { createdAt: 'asc' } });

  beforeAll(async () => {
    await prisma.$connect();
    count = await parameters.get('incidents.cadenceCount');
    windowSeconds = await parameters.get('incidents.cadenceWindowSeconds');
    const staff = (
      await prisma.user.create({
        data: {
          email: `cadence-staff-${runId}@example.invalid`,
          fullName: 'Cadence staff',
          accountType: AccountType.TREKLINK,
        },
      })
    ).id;
    operatorId = (
      await prisma.user.create({
        data: {
          email: `cadence-operator-${runId}@example.invalid`,
          fullName: 'Cadence operator',
          accountType: AccountType.ORGANIZATION,
        },
      })
    ).id;
    const variant = await prisma.hardwareVariant.create({
      data: {
        code: `cadence-${runId}`,
        name: 'Cadence variant',
        hasGps: true,
        hasMotionSensor: false,
        mqttCapable: true,
        firmwareBaseline: 'test-only',
        remainingValueSchedule: [],
      },
    });
    organizationId = (
      await prisma.organization.create({
        data: {
          code: `cadence-${runId}`,
          legalName: 'Cadence test organization',
          taxCode: runId,
          address: 'Test only',
          contactEmail: 'test@example.invalid',
          contactPhone: '0000000000',
          documentsSeen: [],
          status: 'ACTIVE',
        },
      })
    ).id;
    const operator = await prisma.organizationMember.create({
      data: { userId: operatorId, organizationId, role: 'OPERATOR' },
    });
    const now = Date.now();
    await prisma.rosterShift.create({
      data: {
        organizationId,
        startsAt: new Date(now - 3600_000),
        endsAt: new Date(now + 3600_000),
        primaryMemberId: operator.id,
        createdById: operatorId,
      },
    });
    const contract = await prisma.rentalContract.create({
      data: {
        code: `RC-CAD-${runId.slice(0, 8)}`,
        organizationId,
        planType: PlanType.MONTHLY,
        hardwareVariantId: variant.id,
        quantity: 2,
        requestedStartDate: new Date('2026-10-01T00:00:00Z'),
        monthlyUnitPriceVnd: 250_000n,
        holdingFeeRatio: new Prisma.Decimal('0.5'),
        requestedById: operatorId,
        status: ContractStatus.ACTIVE,
      },
    });
    for (const suffix of ['a', 'b']) {
      const nodeNum = Number.parseInt(randomUUID().slice(0, 7), 16);
      const deviceId = (
        await prisma.device.create({
          data: {
            assetTag: `CAD-${suffix}-${runId.slice(0, 8)}`,
            nodeNum: BigInt(nodeNum),
            hardwareVariantId: variant.id,
            firmwareVersion: 'test-only',
            acquiredAt: new Date(now - 86_400_000),
            registeredById: staff,
            status: 'RENTED',
          },
        })
      ).id;
      await prisma.contractDevice.create({
        data: {
          contractId: contract.id,
          deviceId,
          handedOverAt: new Date(now - 86_400_000),
          holderName: 'Le Thi E',
          holderPhone: '0912345678',
        },
      });
      nodes.push({ nodeNum, deviceId });
    }
  });

  afterAll(async () => prisma.$disconnect());

  it('opens exactly one SUSPECTED incident for a burst, joins later positions and upgrades it on an SOS', async () => {
    const [{ nodeNum, deviceId }] = nodes;
    const packets = burst(nodeNum, 300);

    // One position short of the count opens nothing.
    for (const packet of packets.slice(0, -1)) {
      await expect(ingestion.ingest(packet)).resolves.toBe('ACCEPTED');
    }
    expect(await incidentsOf(deviceId)).toHaveLength(0);

    // The count-th position inside the window opens the incident, routed to the primary.
    await expect(ingestion.ingest(packets[packets.length - 1])).resolves.toBe('ACCEPTED');
    const [incident] = await incidentsOf(deviceId);
    expect(incident).toMatchObject({
      state: 'NOTIFY_PRIMARY',
      source: 'CADENCE_INFERRED',
      confidence: 'SUSPECTED',
      organizationId,
      eventCount: 1,
      lastLatitude: 11.5544,
      lastLongitude: 108.5381,
      ownerId: null,
    });
    expect(incident.tierDeadlineAt).not.toBeNull();
    const first = Number(packets[0].message.timestamp) * 1000;
    const last = Number(packets[packets.length - 1].message.timestamp) * 1000;
    expect(incident.firstEventAt.getTime()).toBe(first);
    expect(incident.lastEventAt.getTime()).toBe(last);
    const transitions = await prisma.incidentTransition.findMany({
      where: { incidentId: incident.id },
      orderBy: { seq: 'asc' },
    });
    expect(transitions.map((t) => [t.seq, t.fromState, t.toState, t.reason])).toEqual([
      [1, null, 'DETECTED', 'CREATED'],
      [2, 'DETECTED', 'NOTIFY_PRIMARY', 'ROUTED'],
    ]);
    const opener = await prisma.fieldEvent.findUniqueOrThrow({
      where: { eventId: incident.openedByEventId! },
    });
    expect(opener).toMatchObject({ deviceId, kind: 'POSITION', incidentId: incident.id });
    expect(transitions[0].refEventId).toBe(opener.eventId);
    const alerts = await prisma.alertDelivery.findMany({ where: { incidentId: incident.id } });
    expect(alerts.map((row) => `${row.recipientId ?? 'org'}:${row.channel}`).sort()).toEqual(
      [
        `${operatorId}:EMAIL`,
        `${operatorId}:WEB`,
        `${operatorId}:WEBSOCKET`,
        'org:API_EVENT',
      ].sort(),
    );

    // More positions of the burst join the open incident: no second incident, no new transition.
    await expect(ingestion.ingest(fix(nodeNum, 290))).resolves.toBe('ACCEPTED');
    await expect(ingestion.ingest(fix(nodeNum, 289))).resolves.toBe('ACCEPTED');
    expect(await incidentsOf(deviceId)).toHaveLength(1);
    expect(await prisma.incidentTransition.count({ where: { incidentId: incident.id } })).toBe(2);
    expect(
      await prisma.fieldEvent.count({ where: { deviceId, incidentId: incident.id } }),
    ).toBeGreaterThanOrEqual(3);

    // A later SOS text of the episode upgrades it to CONFIRMED in place.
    await expect(ingestion.ingest(sos(nodeNum))).resolves.toBe('ACCEPTED');
    const upgraded = await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } });
    expect(upgraded).toMatchObject({
      state: 'NOTIFY_PRIMARY',
      source: 'CADENCE_INFERRED',
      confidence: 'CONFIRMED',
      eventCount: 2,
      version: incident.version,
    });
    expect(await incidentsOf(deviceId)).toHaveLength(1);
    expect(await prisma.alertDelivery.count({ where: { incidentId: incident.id } })).toBe(
      alerts.length,
    );

    // Once the episode is CLOSED, a late position that occurred before the close never opens a
    // second incident, though it lands inside the window of the first burst; a new burst after the
    // close opens a new one.
    const closedAt = new Date(Date.now() - 200_000);
    await prisma.incident.update({
      where: { id: incident.id },
      data: { state: 'CLOSED', closedAt, tierDeadlineAt: null },
    });
    await expect(ingestion.ingest(fix(nodeNum, 295))).resolves.toBe('ACCEPTED');
    expect(await incidentsOf(deviceId)).toHaveLength(1);
    for (const packet of burst(nodeNum, 0)) {
      await expect(ingestion.ingest(packet)).resolves.toBe('ACCEPTED');
    }
    const afterClose = await incidentsOf(deviceId);
    expect(afterClose).toHaveLength(2);
    expect(afterClose[1]).toMatchObject({
      state: 'NOTIFY_PRIMARY',
      source: 'CADENCE_INFERRED',
      confidence: 'SUSPECTED',
    });
  });

  it('opens one incident for a burst ingested concurrently', async () => {
    const [, { nodeNum, deviceId }] = nodes;
    const outcomes = await Promise.all(burst(nodeNum, 5).map((packet) => ingestion.ingest(packet)));
    expect(outcomes.every((outcome) => outcome === 'ACCEPTED')).toBe(true);
    // A transaction that counted before an earlier one committed may miss the count; the next
    // position of the burst then completes it, and the lock keeps it to one incident.
    await ingestion.ingest(fix(nodeNum, 2));
    const rows = await incidentsOf(deviceId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'CADENCE_INFERRED', confidence: 'SUSPECTED' });
    expect(await prisma.incidentTransition.count({ where: { incidentId: rows[0].id } })).toBe(2);
  });
});
