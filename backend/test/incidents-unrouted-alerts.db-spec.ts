import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AccountType, IngressPath } from '@prisma/client';
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

// TK-143 / FR-INC-12: real account selection, ingestion, lifecycle and transactional outbox.
// Run on migrated disposable Postgres only. Unique fixtures permit repeated runs without deleting data.
describe('UNROUTED Staff/Admin alerts against Postgres', () => {
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
  const repository = new IncidentsRepository(prisma);
  const alerts = new AlertDeliveriesRepository();
  const lifecycle = new IncidentLifecycle(repository, alerts, parameters, events);
  const routing = new RoutingService(new RosterService(new RosterRepository(prisma)), accounts);
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
  const incidents = new IncidentsService(
    repository,
    lifecycle,
    parameters,
    events,
    {
      memberNames: () => Promise.resolve(new Map<string, string>()),
    } as unknown as OrganizationsService,
    // This suite never sets the device-silent flag.
    {} as StaleAlerts,
  );
  const changed = jest.fn();
  const audited = jest.fn();
  const runId = randomUUID();
  let variantId: string;
  let staffId: string;
  let adminId: string;
  let dualRoleId: string;
  let inactiveId: string;
  let deletedId: string;
  let unprivilegedId: string;
  let organizationId: string;
  let packetId = Number.parseInt(randomUUID().slice(0, 7), 16);
  let serial = 0;

  const device = async () =>
    prisma.device.create({
      data: {
        assetTag: `unrouted-${runId}-${++serial}`,
        nodeNum: BigInt(`0x${randomUUID().slice(0, 8)}`),
        hardwareVariantId: variantId,
        firmwareVersion: 'test-only',
        acquiredAt: new Date(),
        registeredById: staffId,
      },
    });
  const sos = (nodeNum: bigint): CanonicalEnvelope => {
    const message = {
      id: ++packetId,
      from: Number(nodeNum),
      timestamp: Math.ceil(Date.now() / 1000),
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
  const assertRecipients = async (transitionId: string) => {
    const rows = await prisma.alertDelivery.findMany({ where: { transitionId } });
    const expectedIds = await accounts.activeStaffAndAdminIds();
    expect(expectedIds).toEqual(expect.arrayContaining([staffId, adminId, dualRoleId]));
    for (const id of [inactiveId, deletedId, unprivilegedId]) expect(expectedIds).not.toContain(id);
    expect(rows.map((row) => `${row.recipientId}:${row.tier}:${row.channel}`).sort()).toEqual(
      expectedIds
        .flatMap((id) =>
          ['EMAIL', 'WEB', 'WEBSOCKET'].map((channel) => `${id}:TREKLINK:${channel}`),
        )
        .sort(),
    );
    expect(rows.filter((row) => row.recipientId === dualRoleId)).toHaveLength(3);
    return rows.length;
  };

  beforeAll(async () => {
    await prisma.$connect();
    const ids: string[] = [];
    for (const name of ['staff', 'admin', 'dual', 'inactive', 'deleted', 'unprivileged']) {
      ids.push(
        (
          await prisma.user.create({
            data: {
              email: `unrouted-${name}-${runId}@example.invalid`,
              fullName: `UNROUTED ${name}`,
              accountType: AccountType.TREKLINK,
            },
          })
        ).id,
      );
    }
    [staffId, adminId, dualRoleId, inactiveId, deletedId, unprivilegedId] = ids;
    const staffRole = await prisma.role.findUniqueOrThrow({ where: { key: 'STAFF' } });
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { key: 'ADMIN' } });
    await prisma.userRole.createMany({
      data: [
        ...[staffId, dualRoleId, inactiveId, deletedId].map((userId) => ({
          userId,
          roleId: staffRole.id,
        })),
        ...[adminId, dualRoleId].map((userId) => ({ userId, roleId: adminRole.id })),
      ],
    });
    await prisma.user.update({ where: { id: inactiveId }, data: { isActive: false } });
    await prisma.user.update({ where: { id: deletedId }, data: { deletedAt: new Date() } });
    variantId = (
      await prisma.hardwareVariant.create({
        data: {
          code: `unrouted-${runId}`,
          name: 'UNROUTED test',
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
          code: `unrouted-${runId}`,
          legalName: 'No reachable members',
          taxCode: runId,
          address: 'Test',
          contactEmail: 'test@example.invalid',
          contactPhone: '0000000000',
          documentsSeen: [],
          status: 'SUSPENDED',
        },
      })
    ).id;
    emitter.on('incident.changed', changed);
    emitter.on('audit.record', audited);
  });
  beforeEach(() => {
    changed.mockClear();
    audited.mockClear();
  });
  afterAll(async () => prisma.$disconnect());

  it('creates Staff/Admin alerts once and rejects ten replays of the same unattributed SOS', async () => {
    const unit = await device();
    const packet = sos(unit.nodeNum);
    await expect(ingestion.ingest(packet)).resolves.toBe('ACCEPTED_UNATTRIBUTED');
    const incident = await prisma.incident.findFirstOrThrow({ where: { deviceId: unit.id } });
    expect(incident).toMatchObject({ state: 'UNROUTED', organizationId: null, contractId: null });
    const transition = await prisma.incidentTransition.findFirstOrThrow({
      where: { incidentId: incident.id, toState: 'UNROUTED' },
    });
    const count = await assertRecipients(transition.id);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(audited).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 10; i++)
      await expect(ingestion.ingest(packet)).resolves.toBe('DUPLICATE_REJECTED');
    expect(await prisma.incident.count({ where: { deviceId: unit.id } })).toBe(1);
    expect(await prisma.incidentTransition.count({ where: { incidentId: incident.id } })).toBe(2);
    expect(await prisma.alertDelivery.count({ where: { incidentId: incident.id } })).toBe(count);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('reopens FALSE_ALARM to UNROUTED with a fresh, deduplicated recipient snapshot', async () => {
    const unit = await device();
    await ingestion.ingest(sos(unit.nodeNum));
    const incident = await prisma.incident.findFirstOrThrow({ where: { deviceId: unit.id } });
    await incidents.falseAlarm(
      incident.id,
      { expectedVersion: incident.version, reason: 'Safe' },
      {
        id: staffId,
        roles: ['STAFF'],
        organizationId: null,
      },
    );
    const packet = sos(unit.nodeNum);
    await ingestion.ingest(packet);
    expect(await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } })).toMatchObject({
      state: 'UNROUTED',
      reopenCount: 1,
      ownerId: null,
      organizationId: null,
      contractId: null,
    });
    const reopening = await prisma.incidentTransition.findFirstOrThrow({
      where: { incidentId: incident.id, reason: 'REOPENED' },
    });
    const count = await assertRecipients(reopening.id);
    await expect(ingestion.ingest(packet)).resolves.toBe('DUPLICATE_REJECTED');
    expect(await prisma.alertDelivery.count({ where: { transitionId: reopening.id } })).toBe(count);
  });

  it('preserves historical organization attribution when nobody there is reachable', async () => {
    const unit = await device();
    const result = await events.transaction(async (tx) => {
      const at = new Date();
      const { incident } = await repository.insert(
        {
          deviceId: unit.id,
          source: 'DEVICE_SOS',
          confidence: 'CONFIRMED',
          firstEventAt: at,
          lastEventAt: at,
          organizationId,
        },
        at,
        tx,
      );
      const route = await routing.route({ organizationId, contractId: null }, at, tx);
      return lifecycle.apply(
        incident.id,
        'DETECTED',
        route.to,
        { kind: 'SYSTEM' },
        {
          code: 'ROUTED',
          at,
          recipients: route.recipients,
        },
        tx,
      );
    });
    expect(result).toMatchObject({ state: 'UNROUTED', organizationId });
    const transition = await prisma.incidentTransition.findFirstOrThrow({
      where: { incidentId: result.id },
    });
    const rows = await prisma.alertDelivery.findMany({ where: { transitionId: transition.id } });
    expect(rows.filter((row) => row.channel === 'API_EVENT')).toHaveLength(1);
    expect(rows.filter((row) => row.recipientId === staffId)).toHaveLength(3);
    expect(
      rows.filter((row) => row.recipientId === inactiveId || row.recipientId === deletedId),
    ).toHaveLength(0);
  });

  it('rolls back the event, incident, history, outbox and queued notifications if ingestion aborts', async () => {
    const unit = await device();
    const enqueue = jest.spyOn(alerts, 'enqueue');
    enqueue.mockImplementationOnce(async (rows, tx) => {
      await AlertDeliveriesRepository.prototype.enqueue.call(alerts, rows, tx);
      expect(rows.length).toBeGreaterThan(0);
      expect(changed).not.toHaveBeenCalled();
      expect(audited).not.toHaveBeenCalled();
      throw new Error('abort after outbox');
    });
    try {
      await expect(ingestion.ingest(sos(unit.nodeNum))).rejects.toThrow('abort after outbox');
    } finally {
      enqueue.mockRestore();
    }
    expect(await prisma.fieldEvent.count({ where: { deviceId: unit.id } })).toBe(0);
    expect(await prisma.incident.count({ where: { deviceId: unit.id } })).toBe(0);
    expect(
      await prisma.incidentTransition.count({ where: { incident: { deviceId: unit.id } } }),
    ).toBe(0);
    expect(await prisma.alertDelivery.count({ where: { incident: { deviceId: unit.id } } })).toBe(
      0,
    );
    expect(changed).not.toHaveBeenCalled();
    expect(audited).not.toHaveBeenCalled();
  });
});
