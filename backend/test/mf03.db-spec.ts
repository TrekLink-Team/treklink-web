import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AccountType, ContractStatus, IngressPath, PlanType, Prisma } from '@prisma/client';
import { Caller } from '../src/common/decorators/access.decorator';
import { ErrorCode } from '../src/common/errors';
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
import {
  AlertDispatcherJob,
  INCIDENT_ALERT,
  IncidentAlertEvent,
} from '../src/modules/incidents/alerts/alert-dispatcher.job';
import { IncidentIngress } from '../src/modules/incidents/incident-ingress';
import { IncidentLifecycle } from '../src/modules/incidents/incident-lifecycle';
import { IncidentsRepository } from '../src/modules/incidents/incidents.repository';
import { IncidentsService } from '../src/modules/incidents/incidents.service';
import { RoutingService } from '../src/modules/incidents/routing.service';
import { OrganizationsService } from '../src/modules/organizations';
import { RosterRepository } from '../src/modules/organizations/roster.repository';
import { RosterService } from '../src/modules/organizations/roster.service';
import { ValidatedEnvironment } from '../src/modules/platform/config/environment-variables';
import { TransactionalEvents } from '../src/modules/platform/events/emit-after-commit';
import { ParameterRepository } from '../src/modules/platform/parameters/parameter.repository';
import { ParameterService } from '../src/modules/platform/parameters/parameter.service';
import { ContractsRepository } from '../src/modules/rentals/contracts.repository';
import { ContractsService } from '../src/modules/rentals/contracts.service';
import type { StaleAlerts } from '../src/modules/incidents/alerts/stale-alerts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !process.env.DATABASE_DIRECT_URL) {
  throw new Error('test:db requires explicit DATABASE_URL and DATABASE_DIRECT_URL.');
}

// MF-03 happy path against Postgres (D-066): an attributed SOS opens an incident inside ingestion,
// routes it to the on-duty primary, writes the outbox, dispatches the WebSocket alert, and the
// primary acknowledges and resolves it. Run only through test:db on a migrated disposable database.
describe('MF-03, SOS to a resolved incident, against Postgres', () => {
  const prisma = new PrismaService({ datasourceUrl: databaseUrl });
  const emitter = new EventEmitter2();
  const events = new TransactionalEvents(prisma, emitter);
  const parameters = new ParameterService(
    new ParameterRepository(prisma),
    events,
    new ConfigService<ValidatedEnvironment, true>({ PARAMETER_CACHE_TTL_SECONDS: 0 }),
  );
  const incidentsRepository = new IncidentsRepository(prisma);
  const alerts = new AlertDeliveriesRepository();
  const lifecycle = new IncidentLifecycle(incidentsRepository, alerts, parameters, events);
  const roster = new RosterService(new RosterRepository(prisma));
  const ingress = new IncidentIngress(
    incidentsRepository,
    lifecycle,
    new RoutingService(
      roster,
      new AccountsService(
        new AccountsRepository(prisma),
        {} as never,
        {} as never,
        events,
        {} as never,
      ),
    ),
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
  const dispatcher = new AlertDispatcherJob(
    alerts,
    devices,
    contracts,
    parameters,
    events,
    emitter,
    new AccountsService(
      new AccountsRepository(prisma),
      {} as never,
      {} as never,
      events,
      {} as never,
    ),
    { send: () => Promise.resolve() },
  );
  const runId = randomUUID();
  const names = new Map<string, string>();
  const incidents = new IncidentsService(
    incidentsRepository,
    lifecycle,
    parameters,
    events,
    {
      memberNames: (ids: readonly string[]) =>
        Promise.resolve(
          new Map(ids.flatMap((id) => (names.has(id) ? [[id, names.get(id)!]] : []))),
        ),
    } as unknown as OrganizationsService,
    // This suite never sets the device-silent flag.
    {} as StaleAlerts,
  );
  const nodeNum = Number.parseInt(randomUUID().slice(0, 7), 16);
  let packetId = Number.parseInt(randomUUID().slice(0, 7), 16);
  let organizationId: string;
  let operatorId: string;
  let managerId: string;
  let deviceId: string;

  const user = async (name: string, accountType: AccountType) => {
    const row = await prisma.user.create({
      data: {
        email: `mf03-${name}-${runId}@example.invalid`,
        fullName: `MF03 ${name}`,
        accountType,
      },
    });
    names.set(row.id, row.fullName);
    return row.id;
  };

  // A stock text SOS with a fix (TrekLinkSOSHelper.h:19), received now. `aheadSeconds` keeps a later
  // packet's whole-second device time after the previous transition.
  const sos = (aheadSeconds = 0): CanonicalEnvelope => {
    packetId += 1;
    const message = {
      id: packetId,
      from: nodeNum,
      timestamp: Math.ceil(Date.now() / 1000) + aheadSeconds,
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

  // A stock position packet of the same node, as the SOS helper sends next to the text.
  const fix = (aheadSeconds = 0, latitude_i = 115544000): CanonicalEnvelope => {
    packetId += 1;
    const time = Math.ceil(Date.now() / 1000) + aheadSeconds;
    const message = {
      id: packetId,
      from: nodeNum,
      timestamp: time,
      type: 'position' as const,
      sender: `!${nodeNum.toString(16)}`,
      payload: { time, latitude_i, longitude_i: 1085381000, altitude: 1320 },
    };
    return {
      ingress: IngressPath.MQTT_NODE,
      uplinkKey: message.sender,
      receivedAt: new Date(),
      packet: message,
      message,
    };
  };

  const caller = (id: string): Caller => ({ id, roles: ['ORG_OPERATOR'], organizationId });

  beforeAll(async () => {
    await prisma.$connect();
    const staff = await user('staff', AccountType.TREKLINK);
    operatorId = await user('operator', AccountType.ORGANIZATION);
    managerId = await user('manager', AccountType.ORGANIZATION);
    const variant = await prisma.hardwareVariant.create({
      data: {
        code: `mf03-${runId}`,
        name: 'MF03 variant',
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
          code: `mf03-${runId}`,
          legalName: 'MF03 test organization',
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
    const now = Date.now();
    await prisma.rosterShift.create({
      data: {
        organizationId,
        startsAt: new Date(now - 3600_000),
        endsAt: new Date(now + 3600_000),
        primaryMemberId: operator.id,
        backupMemberId: manager.id,
        createdById: managerId,
      },
    });
    deviceId = (
      await prisma.device.create({
        data: {
          assetTag: `MF03-${runId.slice(0, 8)}`,
          nodeNum: BigInt(nodeNum),
          hardwareVariantId: variant.id,
          firmwareVersion: 'test-only',
          acquiredAt: new Date(now - 86_400_000),
          registeredById: staff,
          status: 'RENTED',
        },
      })
    ).id;
    const contract = await prisma.rentalContract.create({
      data: {
        code: `RC-MF03-${runId.slice(0, 8)}`,
        organizationId,
        planType: PlanType.MONTHLY,
        hardwareVariantId: variant.id,
        quantity: 1,
        requestedStartDate: new Date('2026-10-01T00:00:00Z'),
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
        handedOverAt: new Date(now - 86_400_000),
        holderName: 'Le Thi E',
        holderPhone: '0912345678',
      },
    });
  });

  afterAll(async () => prisma.$disconnect());

  it('runs the main success scenario end to end', async () => {
    const delivered: IncidentAlertEvent[] = [];
    emitter.on(INCIDENT_ALERT, (event: IncidentAlertEvent) => delivered.push(event));

    // 1. Ingestion stores the SOS, opens the incident and routes it to the primary.
    const first = sos();
    await expect(ingestion.ingest(first)).resolves.toBe('ACCEPTED');
    const incident = await prisma.incident.findFirstOrThrow({ where: { deviceId } });
    expect(incident).toMatchObject({
      state: 'NOTIFY_PRIMARY',
      organizationId,
      source: 'DEVICE_SOS',
      confidence: 'CONFIRMED',
      eventCount: 1,
      // The SOS text carries no position on the wire (FGT: the fix rides a separate POSITION_APP
      // packet), which reaches the incident through onPosition below.
      lastLatitude: null,
      lastLongitude: null,
      ownerId: null,
    });
    expect(incident.tierDeadlineAt).not.toBeNull();
    const transitions = await prisma.incidentTransition.findMany({
      where: { incidentId: incident.id },
      orderBy: { seq: 'asc' },
    });
    expect(transitions.map((t) => [t.seq, t.fromState, t.toState, t.reason])).toEqual([
      [1, null, 'DETECTED', 'CREATED'],
      [2, 'DETECTED', 'NOTIFY_PRIMARY', 'ROUTED'],
    ]);
    const event = await prisma.fieldEvent.findFirstOrThrow({ where: { deviceId } });
    expect(event.incidentId).toBe(incident.id);
    const rows = await prisma.alertDelivery.findMany({ where: { incidentId: incident.id } });
    expect(rows.map((row) => `${row.recipientId ?? 'org'}:${row.channel}`).sort()).toEqual(
      [
        `${operatorId}:EMAIL`,
        `${operatorId}:WEB`,
        `${operatorId}:WEBSOCKET`,
        'org:API_EVENT',
      ].sort(),
    );

    // 1b. The device's position packet joins the episode and gives the incident its position.
    const latest = fix(4);
    await expect(ingestion.ingest(latest)).resolves.toBe('ACCEPTED');
    const located = await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } });
    expect(located).toMatchObject({
      lastLatitude: 11.5544,
      lastLongitude: 108.5381,
      eventCount: 1,
      version: incident.version,
    });
    expect(located.lastPositionAt?.getTime()).toBe(Number(latest.message.timestamp) * 1000);

    // 1c. An out-of-order fix, newer than the SOS but older than the stored fix, joins the episode
    //     without overwriting the newer position (PR #114 review).
    await expect(ingestion.ingest(fix(2, 116000000))).resolves.toBe('ACCEPTED');
    expect(await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } })).toMatchObject({
      lastLatitude: 11.5544,
      lastPositionAt: located.lastPositionAt,
    });
    const positionEvent = await prisma.fieldEvent.findFirstOrThrow({
      where: { deviceId, kind: 'POSITION' },
    });
    expect(positionEvent.incidentId).toBe(incident.id);

    // 2. A replay of the same packet is rejected before it reaches incidents (REQ-ERR-03).
    await expect(ingestion.ingest(first)).resolves.toBe('DUPLICATE_REJECTED');
    expect(
      (await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } })).eventCount,
    ).toBe(1);

    // 3. The dispatcher sends the web inbox, WebSocket and email rows; the API event waits.
    // Other suites leave due rows in this disposable database. One dispatcher batch need not
    // reach this incident; drain the finite due WEB and WEBSOCKET backlog rather than depending on
    // suite order.
    let remaining = await prisma.alertDelivery.count({
      where: {
        status: 'PENDING',
        channel: { in: ['WEB', 'WEBSOCKET'] },
        nextAttemptAt: { lte: new Date() },
      },
    });
    let sent = 0;
    while (remaining > 0) {
      const batch = await dispatcher.deliverAlerts();
      expect(batch).toBeGreaterThan(0);
      sent += batch;
      remaining -= batch;
    }
    expect(sent).toBeGreaterThanOrEqual(2);
    // The email lane keeps claiming until a batch comes back short, so one run drains its backlog.
    await dispatcher.deliverEmailAlerts();
    expect(delivered).toContainEqual({
      recipientId: operatorId,
      alert: expect.objectContaining({
        incidentId: incident.id,
        holderName: 'Le Thi E',
        message: expect.stringMatching(
          /^SOS: MF03-.+ \(Le Thi E\), \d\d:\d\d\. Acknowledge now\.$/,
        ) as unknown,
      }) as unknown,
    });
    const statuses = await prisma.alertDelivery.findMany({ where: { incidentId: incident.id } });
    expect(Object.fromEntries(statuses.map((row) => [row.channel, row.status]))).toEqual({
      WEB: 'SENT',
      WEBSOCKET: 'SENT',
      EMAIL: 'SENT',
      API_EVENT: 'PENDING',
    });

    // 4. A second SOS joins the open episode without a new transition.
    await expect(ingestion.ingest(sos())).resolves.toBe('ACCEPTED');
    const joined = await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } });
    expect(joined).toMatchObject({
      eventCount: 2,
      state: 'NOTIFY_PRIMARY',
      version: incident.version,
    });

    // 5. The primary acknowledges; the backup, too late, gets MSG27 naming the owner.
    const acknowledged = await incidents.acknowledge(
      incident.id,
      { expectedVersion: joined.version },
      caller(operatorId),
    );
    expect(acknowledged).toMatchObject({ state: 'ACKNOWLEDGED', ownerId: operatorId });
    await expect(
      incidents.acknowledge(incident.id, { expectedVersion: joined.version }, caller(managerId)),
    ).rejects.toMatchObject({
      errorCode: ErrorCode.ALREADY_OWNED,
      message: expect.stringMatching(
        /^MF03 operator took this incident at \d\d:\d\d\.$/,
      ) as unknown,
    });

    // 6. The owner reports, posts a status and resolves.
    const responding = await incidents.responding(
      incident.id,
      { expectedVersion: acknowledged.version, note: 'Guide team dispatched' },
      caller(operatorId),
    );
    await incidents.addStatus(incident.id, { note: 'Reached the holder' }, caller(operatorId));
    const resolved = await incidents.resolve(
      incident.id,
      { expectedVersion: responding.version, outcomeNote: 'Walked out with assistance' },
      caller(operatorId),
    );
    expect(resolved).toMatchObject({
      state: 'RESOLVED',
      outcomeNote: 'Walked out with assistance',
    });
    expect(resolved.reopenWindowEndsAt).not.toBeNull();

    // 7. An SOS inside the reopen window reopens the incident, re-routed to the primary.
    await expect(ingestion.ingest(sos(2))).resolves.toBe('ACCEPTED');
    const reopened = await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } });
    expect(reopened).toMatchObject({ state: 'NOTIFY_PRIMARY', reopenCount: 1, ownerId: null });

    // Ends the open incident as a false alarm through the API path.
    const falseAlarm = async (id: string) => {
      const current = await prisma.incident.findUniqueOrThrow({ where: { id } });
      await incidents.falseAlarm(
        id,
        { expectedVersion: current.version, reason: 'Pressed by mistake' },
        caller(operatorId),
      );
    };
    const openIncidents = () =>
      prisma.incident.findMany({ where: { deviceId, state: { not: 'CLOSED' } } });

    // 8. Past the reopen window, the system (no actor) closes the episode a person already ended,
    //    as the closeAfterReopenWindow job would, and the new SOS opens a new incident. No packet
    //    ends an incident (REQ-UBI-05, D-038 rule 2).
    await falseAlarm(incident.id);
    await prisma.incident.update({
      where: { id: incident.id },
      data: { reopenWindowEndsAt: new Date(Date.now() - 1000) },
    });
    await expect(ingestion.ingest(sos(3))).resolves.toBe('ACCEPTED');
    expect(await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } })).toMatchObject({
      state: 'CLOSED',
    });
    const [second] = await openIncidents();
    expect(second).toMatchObject({ state: 'NOTIFY_PRIMARY', organizationId, eventCount: 1 });
    expect(second.id).not.toBe(incident.id);
    const closing = await prisma.incidentTransition.findFirstOrThrow({
      where: { incidentId: incident.id, toState: 'CLOSED' },
    });
    expect(closing).toMatchObject({
      fromState: 'FALSE_ALARM',
      reason: 'REOPEN_WINDOW_ENDED',
      actorId: null,
    });

    // 9. Inside the window, an unattributed SOS reopens the episode, routed as a new unattributed
    //    incident would be: UNROUTED, with no organization. Nothing is closed.
    await falseAlarm(second.id);
    await prisma.contractDevice.updateMany({
      where: { deviceId },
      data: { checkedInAt: new Date(Date.now() - 10 * 60_000) },
    });
    await expect(ingestion.ingest(sos(4))).resolves.toBe('ACCEPTED_UNATTRIBUTED');
    const open = await openIncidents();
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      id: second.id,
      state: 'UNROUTED',
      organizationId: null,
      contractId: null,
      ownerId: null,
      reopenCount: 1,
      eventCount: 2,
    });
    const reopening = await prisma.incidentTransition.findMany({
      where: { incidentId: second.id },
      orderBy: { seq: 'desc' },
      take: 1,
    });
    expect(reopening[0]).toMatchObject({
      fromState: 'FALSE_ALARM',
      toState: 'UNROUTED',
      reason: 'REOPENED',
    });
    expect(
      await prisma.incidentTransition.count({
        where: { incidentId: second.id, toState: 'CLOSED' },
      }),
    ).toBe(0);
  });
});
