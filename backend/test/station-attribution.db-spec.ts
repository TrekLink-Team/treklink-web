import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AccountType, ContractStatus, IngressPath, PlanType, Prisma } from '@prisma/client';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { AccountsService } from '../src/modules/auth';
import { AccountsRepository } from '../src/modules/auth/accounts.repository';
import { DevicesRepository } from '../src/modules/devices/devices.repository';
import { DevicesService } from '../src/modules/devices/devices.service';
import { FieldStationJsonAdapter } from '../src/modules/gateway-sync/adapters/field-station-json.adapter';
import { CanonicalEnvelope } from '../src/modules/gateway-sync/canonical-envelope';
import { FIELD_POSITION, FieldPositionEvent } from '../src/modules/gateway-sync/field-events';
import { IngestionRepository } from '../src/modules/gateway-sync/ingestion.repository';
import { IngestionService } from '../src/modules/gateway-sync/ingestion.service';
import { Normalizer } from '../src/modules/gateway-sync/normalizer/normalizer';
import { fixture } from '../src/modules/gateway-sync/testing/fixtures';
import { AlertDeliveriesRepository } from '../src/modules/incidents/alert-deliveries.repository';
import { IncidentIngress } from '../src/modules/incidents/incident-ingress';
import { IncidentLifecycle } from '../src/modules/incidents/incident-lifecycle';
import { IncidentsRepository } from '../src/modules/incidents/incidents.repository';
import { RoutingService } from '../src/modules/incidents/routing.service';
import { FieldStationsService } from '../src/modules/organizations';
import { FieldStationsRepository } from '../src/modules/organizations/field-stations.repository';
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
if (/\.neon\.tech\b/.test(databaseUrl)) {
  throw new Error(
    'station-attribution.db-spec.ts runs on a disposable local Postgres, never Neon.',
  );
}

const HOUR = 3_600_000;
const SKEW = 3 * HOUR; // the station clock of these tests runs 3 h fast (design §8)

// gateway-sync task 2.4, AC-06 to AC-08 (D-040, D-042), with two organizations: the real ingestion,
// rentals custody, organizations station lookup, incident ingress and routing against Postgres. Each
// case has its own device, so the cases do not share custody or incidents. Fixtures carry a unique run
// id; nothing existing is deleted. Run only through test:db on a migrated disposable database.
describe('Station attribution (AC-06 to AC-08) against Postgres', () => {
  const prisma = new PrismaService({ datasourceUrl: databaseUrl });
  const emitter = new EventEmitter2();
  const events = new TransactionalEvents(prisma, emitter);
  const parameters = new ParameterService(
    new ParameterRepository(prisma),
    events,
    new ConfigService<ValidatedEnvironment, true>({ PARAMETER_CACHE_TTL_SECONDS: 0 }),
  );
  const accounts = new AccountsService(
    new AccountsRepository(prisma),
    {} as never,
    {} as never,
    events,
    {} as never,
  );
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
    new RoutingService(new RosterService(new RosterRepository(prisma)), accounts),
    parameters,
    events,
  );
  const devices = new DevicesService(new DevicesRepository(prisma), {} as never, {} as never);
  const contracts = new ContractsService(
    new ContractsRepository(prisma),
    {} as never,
    {} as never,
    {} as never,
    events,
    devices,
  );
  const stations = new FieldStationsService(
    new FieldStationsRepository(prisma),
    {} as never,
    {} as never,
    parameters,
    events,
    new ConfigService<ValidatedEnvironment, true>({
      BCRYPT_COST: 4,
      MQTT_BROKER_URL: 'mqtt://localhost:1883',
    }),
  );
  const ingestion = new IngestionService(
    new IngestionRepository(prisma),
    devices,
    contracts,
    ingress,
    new Normalizer(),
    parameters,
    events,
    stations,
  );
  const adapter = new FieldStationJsonAdapter({
    get: () => 'treklink',
  } as unknown as ConfigService<ValidatedEnvironment, true>);

  const runId = randomUUID();
  const short = runId.slice(0, 8);
  let packetId = Number.parseInt(randomUUID().slice(0, 7), 16);
  let serial = 0;
  let staffId: string;
  let variantId: string;
  let graceHours: number;
  let marginSeconds: number;
  const org = { a: { id: '', userIds: [] as string[] }, b: { id: '', userIds: [] as string[] } };
  let stationA: { id: string; username: string };
  const positions: FieldPositionEvent[] = [];

  const user = async (name: string, accountType: AccountType) =>
    (
      await prisma.user.create({
        data: {
          email: `w10-${name}-${runId}@example.invalid`,
          fullName: `W10 ${name}`,
          accountType,
        },
      })
    ).id;

  // An ACTIVE organization with an operator on duty now and a manager as backup, so a routed incident
  // has recipients in it: "B receives nothing" then means routing chose not to reach B.
  const organization = async (key: 'a' | 'b') => {
    const id = (
      await prisma.organization.create({
        data: {
          code: `w10-${key}-${runId}`,
          legalName: `W10 organization ${key.toUpperCase()}`,
          taxCode: `${key}-${runId}`,
          address: 'Test only',
          contactEmail: 'test@example.invalid',
          contactPhone: '0000000000',
          documentsSeen: [],
          status: 'ACTIVE',
        },
      })
    ).id;
    const operatorId = await user(`${key}-operator`, AccountType.ORGANIZATION);
    const managerId = await user(`${key}-manager`, AccountType.ORGANIZATION);
    const [operator, manager] = await Promise.all(
      [
        [operatorId, 'OPERATOR'],
        [managerId, 'MANAGER'],
      ].map(([userId, role]) =>
        prisma.organizationMember.create({
          data: { userId, organizationId: id, role: role as 'OPERATOR' | 'MANAGER' },
        }),
      ),
    );
    await prisma.rosterShift.create({
      data: {
        organizationId: id,
        startsAt: new Date(Date.now() - 2 * HOUR),
        endsAt: new Date(Date.now() + 2 * HOUR),
        primaryMemberId: operator.id,
        backupMemberId: manager.id,
        createdById: managerId,
      },
    });
    org[key] = { id, userIds: [operatorId, managerId] };
  };

  const device = async () => {
    const nodeNum = BigInt(`0x${randomUUID().slice(0, 8)}`);
    const { id } = await prisma.device.create({
      data: {
        assetTag: `W10-${short}-${++serial}`,
        nodeNum,
        hardwareVariantId: variantId,
        firmwareVersion: 'test-only',
        acquiredAt: new Date(Date.now() - 400 * HOUR),
        registeredById: staffId,
        status: 'RENTED',
      },
    });
    return { id, nodeNum: Number(nodeNum) };
  };

  // One custody interval of the device on a contract of the organization.
  const custody = async (
    key: 'a' | 'b',
    deviceId: string,
    handedOverAt: Date,
    checkedInAt: Date | null,
  ) => {
    const contract = await prisma.rentalContract.create({
      data: {
        code: `RC-W10-${short}-${++serial}`,
        organizationId: org[key].id,
        planType: PlanType.MONTHLY,
        hardwareVariantId: variantId,
        quantity: 1,
        requestedStartDate: new Date('2026-09-01T00:00:00Z'),
        monthlyUnitPriceVnd: 250_000n,
        holdingFeeRatio: new Prisma.Decimal('0.5'),
        requestedById: org[key].userIds[1],
        status: ContractStatus.ACTIVE,
      },
    });
    return prisma.contractDevice.create({
      data: { contractId: contract.id, deviceId, handedOverAt, checkedInAt },
    });
  };

  // The E02-7 fixture as A's station flushes it: this run's device and packet id, captured at
  // `capturedAt` (true time) and sent at `receivedAt`, both on the station clock running SKEW fast.
  const stationSos = (nodeNum: number, capturedAt: Date, receivedAt: Date): CanonicalEnvelope => {
    const [{ body }] = fixture('station-sos-e02-7');
    const message = JSON.parse(body.toString('utf8')) as Record<string, unknown>;
    Object.assign(message, {
      id: ++packetId,
      from: nodeNum,
      fs_captured_at: capturedAt.getTime() + SKEW,
      fs_sent_at: receivedAt.getTime() + SKEW,
    });
    const topic = `treklink/fs/${stationA.username}/2/json/LongFast/!de0000a1`;
    const result = adapter.adapt(topic, Buffer.from(JSON.stringify(message)), receivedAt);
    if (result.kind !== 'envelope')
      throw new Error(`station fixture did not adapt: ${result.kind}`);
    return result.envelope;
  };

  // A Stage A packet of the node's own uplink with rx_time 0 (no valid RTC), received now.
  const nodePacket = (
    nodeNum: number,
    type: 'text' | 'position',
    receivedAt: Date,
  ): CanonicalEnvelope => {
    const message = {
      id: ++packetId,
      from: nodeNum,
      timestamp: 0,
      type,
      sender: `!${nodeNum.toString(16).padStart(8, '0')}`,
      payload:
        type === 'text'
          ? { text: 'SOS - [11.561000], [108.552000]' }
          : { latitude_i: 115544000, longitude_i: 1085381000, altitude: 1320 },
    };
    return {
      ingress: IngressPath.MQTT_NODE,
      uplinkKey: message.sender,
      receivedAt,
      packet: message,
      message,
    };
  };

  const recipientsOf = async (incidentId: string) =>
    (await prisma.alertDelivery.findMany({ where: { incidentId } })).map((row) => row.recipientId);

  beforeAll(async () => {
    await prisma.$connect();
    staffId = await user('staff', AccountType.TREKLINK);
    const staffRole = await prisma.role.findUniqueOrThrow({ where: { key: 'STAFF' } });
    await prisma.userRole.create({ data: { userId: staffId, roleId: staffRole.id } });
    variantId = (
      await prisma.hardwareVariant.create({
        data: {
          code: `w10-${runId}`,
          name: 'W10 variant',
          hasGps: true,
          hasMotionSensor: false,
          mqttCapable: true,
          firmwareBaseline: 'test-only',
          remainingValueSchedule: [],
        },
      })
    ).id;
    await organization('a');
    await organization('b');
    const username = `fs-w10-${short}-a`;
    stationA = {
      username,
      id: (
        await prisma.fieldStation.create({
          data: {
            organizationId: org.a.id,
            name: 'W10 station A',
            mqttUsername: username,
            secretHash: 'not-a-real-hash',
            createdById: org.a.userIds[1],
            queueDepth: [],
          },
        })
      ).id,
    };
    graceHours = await parameters.get('gatewaySync.lateUploadGraceHours');
    marginSeconds = await parameters.get('gatewaySync.attributionMarginSeconds');
    emitter.on(FIELD_POSITION, (event: FieldPositionEvent) => positions.push(event));
  });

  afterAll(async () => prisma.$disconnect());

  it("AC-06: A's station flushes an SOS from A's custody after the unit moved to B", async () => {
    const now = new Date();
    const unit = await device();
    const intervalA = await custody(
      'a',
      unit.id,
      new Date(now.getTime() - 30 * HOUR),
      new Date(now.getTime() - 6 * HOUR),
    );
    await custody('b', unit.id, new Date(now.getTime() - 5 * HOUR), null);
    const capturedAt = new Date(now.getTime() - 20 * HOUR);

    await expect(ingestion.ingest(stationSos(unit.nodeNum, capturedAt, now))).resolves.toBe(
      'ACCEPTED',
    );

    const event = await prisma.fieldEvent.findFirstOrThrow({ where: { deviceId: unit.id } });
    expect(event).toMatchObject({
      ingress: 'FIELD_STATION',
      uplinkKey: stationA.username,
      fieldStationId: stationA.id,
      kind: 'SOS',
      timeSource: 'STATION_CORRECTED',
      occurredAt: capturedAt,
      capturedAt: new Date(capturedAt.getTime() + SKEW),
      attribution: 'ATTRIBUTED',
      organizationId: org.a.id,
      contractDeviceId: intervalA.id,
    });
    const audit = await prisma.syncAuditLog.findFirstOrThrow({ where: { eventId: event.eventId } });
    expect(audit.outcome).toBe('ACCEPTED');

    // The incident routes to A's roster; B, which holds the unit now, receives nothing.
    const incident = await prisma.incident.findFirstOrThrow({ where: { deviceId: unit.id } });
    expect(incident).toMatchObject({ organizationId: org.a.id, state: 'NOTIFY_PRIMARY' });
    expect(event.incidentId).toBe(incident.id);
    const recipients = await recipientsOf(incident.id);
    expect(recipients).toContain(org.a.userIds[0]);
    for (const id of recipients) if (id !== null) expect(org.a.userIds).toContain(id);
    await expect(
      prisma.fieldEvent.count({ where: { deviceId: unit.id, organizationId: org.b.id } }),
    ).resolves.toBe(0);
    await expect(
      prisma.incident.count({ where: { deviceId: unit.id, organizationId: org.b.id } }),
    ).resolves.toBe(0);
  });

  it("leaves an event A's station captured during B's custody UNATTRIBUTED, for Staff only", async () => {
    const now = new Date();
    const unit = await device();
    await custody(
      'a',
      unit.id,
      new Date(now.getTime() - 30 * HOUR),
      new Date(now.getTime() - 6 * HOUR),
    );
    await custody('b', unit.id, new Date(now.getTime() - 5 * HOUR), null);

    await expect(
      ingestion.ingest(stationSos(unit.nodeNum, new Date(now.getTime() - 2 * HOUR), now)),
    ).resolves.toBe('ACCEPTED_UNATTRIBUTED');

    const event = await prisma.fieldEvent.findFirstOrThrow({ where: { deviceId: unit.id } });
    expect(event).toMatchObject({
      attribution: 'UNATTRIBUTED',
      organizationId: null,
      contractDeviceId: null,
      fieldStationId: stationA.id,
      timeSource: 'STATION_CORRECTED',
    });
    const audit = await prisma.syncAuditLog.findFirstOrThrow({ where: { eventId: event.eventId } });
    expect(audit.outcome).toBe('ACCEPTED_UNATTRIBUTED');
    expect(audit.detail).toMatch(/^STATION_ORGANIZATION_DIFFERS: /);
    const incident = await prisma.incident.findFirstOrThrow({ where: { deviceId: unit.id } });
    expect(incident).toMatchObject({ organizationId: null, state: 'UNROUTED' });
    const recipients = await recipientsOf(incident.id);
    expect(recipients).toContain(staffId);
    for (const id of [...org.a.userIds, ...org.b.userIds]) expect(recipients).not.toContain(id);
  });

  it('AC-07: a Stage A event with rx_time 0 just after a handover is UNATTRIBUTED, for Staff only', async () => {
    const now = new Date();
    const unit = await device();
    const handover = new Date(now.getTime() - (marginSeconds / 2) * 1000);
    await custody(
      'a',
      unit.id,
      new Date(now.getTime() - 30 * HOUR),
      new Date(handover.getTime() - 60_000),
    );
    await custody('b', unit.id, handover, null);

    await expect(ingestion.ingest(nodePacket(unit.nodeNum, 'text', now))).resolves.toBe(
      'ACCEPTED_UNATTRIBUTED',
    );
    await expect(ingestion.ingest(nodePacket(unit.nodeNum, 'position', now))).resolves.toBe(
      'ACCEPTED_UNATTRIBUTED',
    );

    const stored = await prisma.fieldEvent.findMany({ where: { deviceId: unit.id } });
    expect(stored).toHaveLength(2);
    const audits = await prisma.syncAuditLog.findMany({ where: { deviceId: unit.id } });
    expect(audits.map((row) => row.detail)).toEqual([
      expect.stringMatching(/^NEAR_HANDOVER: /),
      expect.stringMatching(/^NEAR_HANDOVER: /),
    ]);
    for (const event of stored) {
      expect(event).toMatchObject({
        ingress: 'MQTT_NODE',
        timeSource: 'SERVER_RECEIPT',
        observedAt: null,
        occurredAt: now,
        attribution: 'UNATTRIBUTED',
        organizationId: null,
        contractDeviceId: null,
      });
    }
    const incident = await prisma.incident.findFirstOrThrow({ where: { deviceId: unit.id } });
    expect(incident).toMatchObject({ organizationId: null, state: 'UNROUTED' });
    const recipients = await recipientsOf(incident.id);
    expect(recipients).toContain(staffId);
    for (const id of [...org.a.userIds, ...org.b.userIds]) expect(recipients).not.toContain(id);
    // The live stream gets the position with no organization: the fleet view of Staff and Admin.
    expect(positions.filter((p) => p.deviceId === unit.id)).toEqual([
      expect.objectContaining({ organizationId: null }),
    ]);
  });

  it("AC-08: A's station flushing more than the late-upload grace after check-in is refused", async () => {
    const now = new Date();
    const unit = await device();
    const checkIn = new Date(now.getTime() - (graceHours + 1) * HOUR);
    await custody('a', unit.id, new Date(checkIn.getTime() - 48 * HOUR), checkIn);
    const envelope = stationSos(unit.nodeNum, new Date(checkIn.getTime() - 10 * HOUR), now);

    await expect(ingestion.ingest(envelope)).resolves.toBe('NOT_RENTED_TO_STATION_ORG');

    await expect(prisma.fieldEvent.count({ where: { deviceId: unit.id } })).resolves.toBe(0);
    await expect(prisma.incident.count({ where: { deviceId: unit.id } })).resolves.toBe(0);
    const audits = await prisma.syncAuditLog.findMany({ where: { deviceId: unit.id } });
    expect(audits).toEqual([
      expect.objectContaining({
        outcome: 'NOT_RENTED_TO_STATION_ORG',
        ingress: 'FIELD_STATION',
        uplinkKey: stationA.username,
        detail: `the organization of Field Station ${stationA.username} neither holds the device nor returned it within the late-upload grace`,
      }),
    ]);
  });
});
