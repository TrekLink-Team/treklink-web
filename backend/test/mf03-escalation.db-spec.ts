import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AccountType, IncidentConfidence, IncidentSource } from '@prisma/client';
import { Caller } from '../src/common/decorators/access.decorator';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { AccountsService } from '../src/modules/auth';
import { AccountsRepository } from '../src/modules/auth/accounts.repository';
import { AlertDeliveriesRepository } from '../src/modules/incidents/alert-deliveries.repository';
import { IncidentLifecycle } from '../src/modules/incidents/incident-lifecycle';
import { IncidentsRepository } from '../src/modules/incidents/incidents.repository';
import { IncidentsService } from '../src/modules/incidents/incidents.service';
import { IncidentTimersJob } from '../src/modules/incidents/jobs/incident-timers.job';
import { RoutingService } from '../src/modules/incidents/routing.service';
import { OrganizationsService } from '../src/modules/organizations';
import { RosterRepository } from '../src/modules/organizations/roster.repository';
import { RosterService } from '../src/modules/organizations/roster.service';
import { ValidatedEnvironment } from '../src/modules/platform/config/environment-variables';
import { TransactionalEvents } from '../src/modules/platform/events/emit-after-commit';
import { ParameterRepository } from '../src/modules/platform/parameters/parameter.repository';
import { ParameterService } from '../src/modules/platform/parameters/parameter.service';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !process.env.DATABASE_DIRECT_URL) {
  throw new Error('test:db requires explicit DATABASE_URL and DATABASE_DIRECT_URL.');
}

// MF-03 escalation half against Postgres (incidents 3.1, AC-02, REQ-EVT-04, REQ-EVT-07,
// REQ-EVT-10). Deadlines are moved into the past instead of waiting, then each job runs once. The
// jobs act on every due incident in the database, so assertions read this run's incidents only.
// Run only through test:db on a migrated disposable database. Never deletes data.
describe('MF-03 escalation timers against Postgres', () => {
  const prisma = new PrismaService({ datasourceUrl: databaseUrl });
  const events = new TransactionalEvents(prisma, new EventEmitter2());
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
  // Only activeStaffAndAdminIds is used, so the code, password and config collaborators are left out.
  const accounts = new AccountsService(
    new AccountsRepository(prisma),
    {} as never,
    {} as never,
    events,
    {} as never,
  );
  const routing = new RoutingService(new RosterService(new RosterRepository(prisma)), accounts);
  const job = new IncidentTimersJob(repository, lifecycle, routing, events);
  const incidents = new IncidentsService(repository, lifecycle, parameters, events, {
    memberNames: () => Promise.resolve(new Map<string, string>()),
  } as unknown as OrganizationsService);
  const runId = randomUUID();
  let organizationId: string;
  let operatorId: string;
  let managerId: string;
  let variantId: string;
  let staffId: string;
  let secondStaffId: string;
  let inactiveStaffId: string;
  let adminId: string;
  let serial = 0;

  const user = async (name: string, accountType: AccountType) =>
    (
      await prisma.user.create({
        data: {
          email: `timers-${name}-${runId}@example.invalid`,
          fullName: `Timers ${name}`,
          accountType,
        },
      })
    ).id;

  const caller = (): Caller => ({ id: operatorId, roles: ['ORG_OPERATOR'], organizationId });

  // An incident routed to this run's organization at NOTIFY_PRIMARY, as ingress opens one.
  const routedIncident = async () => {
    serial += 1;
    const device = await prisma.device.create({
      data: {
        assetTag: `timers-${runId.slice(0, 8)}-${serial}`,
        nodeNum: BigInt(`0x${randomUUID().slice(0, 8)}`),
        hardwareVariantId: variantId,
        firmwareVersion: 'test-only',
        acquiredAt: new Date(Date.now() - 86_400_000),
        registeredById: staffId,
        status: 'RENTED',
      },
    });
    return events.transaction(async (tx) => {
      const now = new Date();
      const { incident } = await repository.insert(
        {
          deviceId: device.id,
          source: IncidentSource.DEVICE_SOS,
          confidence: IncidentConfidence.CONFIRMED,
          firstEventAt: now,
          lastEventAt: now,
          organizationId,
        },
        now,
        tx,
      );
      const route = await routing.route({ organizationId, contractId: null }, now, tx);
      return lifecycle.apply(
        incident.id,
        'DETECTED',
        route.to,
        { kind: 'SYSTEM' },
        { code: 'ROUTED', at: now, recipients: route.recipients },
        tx,
      );
    });
  };

  const past = () => new Date(Date.now() - 1000);
  const read = (id: string) => prisma.incident.findUniqueOrThrow({ where: { id } });
  const history = async (id: string) =>
    (
      await prisma.incidentTransition.findMany({
        where: { incidentId: id },
        orderBy: { seq: 'asc' },
      })
    ).map((row) => [row.fromState, row.toState, row.reason, row.actorId]);

  beforeAll(async () => {
    await prisma.$connect();
    staffId = await user('staff', AccountType.TREKLINK);
    secondStaffId = await user('second-staff', AccountType.TREKLINK);
    inactiveStaffId = await user('inactive-staff', AccountType.TREKLINK);
    adminId = await user('admin', AccountType.TREKLINK);
    const staffRole = await prisma.role.findUniqueOrThrow({ where: { key: 'STAFF' } });
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { key: 'ADMIN' } });
    await prisma.userRole.createMany({
      data: [
        ...[staffId, secondStaffId, inactiveStaffId].map((userId) => ({
          userId,
          roleId: staffRole.id,
        })),
        { userId: adminId, roleId: adminRole.id },
      ],
    });
    await prisma.user.update({ where: { id: inactiveStaffId }, data: { isActive: false } });
    operatorId = await user('operator', AccountType.ORGANIZATION);
    managerId = await user('manager', AccountType.ORGANIZATION);
    variantId = (
      await prisma.hardwareVariant.create({
        data: {
          code: `timers-${runId}`,
          name: 'Timers variant',
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
          code: `timers-${runId}`,
          legalName: 'Timers test organization',
          taxCode: `t-${runId}`,
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
    await prisma.organizationMember.create({
      data: { userId: managerId, organizationId, role: 'MANAGER' },
    });
    // No backup on the shift, so the backup tier is skipped (BR-16).
    await prisma.rosterShift.create({
      data: {
        organizationId,
        startsAt: new Date(Date.now() - 3600_000),
        endsAt: new Date(Date.now() + 3600_000),
        primaryMemberId: operator.id,
        createdById: managerId,
      },
    });
  });

  afterAll(async () => prisma.$disconnect());

  it('walks primary, the empty backup, Manager, then ESCALATED with nobody acknowledging (AC-02)', async () => {
    const incident = await routedIncident();
    expect(incident.state).toBe('NOTIFY_PRIMARY');

    // Not due yet: the job leaves it alone.
    await job.tierTimeouts();
    expect((await read(incident.id)).state).toBe('NOTIFY_PRIMARY');

    await prisma.incident.update({ where: { id: incident.id }, data: { tierDeadlineAt: past() } });
    await job.tierTimeouts();
    const manager = await read(incident.id);
    expect(manager.state).toBe('NOTIFY_MANAGER');
    expect(manager.tierDeadlineAt!.getTime()).toBeGreaterThan(Date.now());

    await prisma.incident.update({ where: { id: incident.id }, data: { tierDeadlineAt: past() } });
    await job.tierTimeouts();
    const escalated = await read(incident.id);
    expect(escalated).toMatchObject({ state: 'ESCALATED', tierDeadlineAt: null, ownerId: null });

    expect(await history(incident.id)).toEqual([
      ['DETECTED', 'NOTIFY_PRIMARY', 'ROUTED', null],
      ['NOTIFY_PRIMARY', 'NOTIFY_BACKUP', 'TIER_TIMEOUT', null],
      ['NOTIFY_BACKUP', 'NOTIFY_MANAGER', 'EMPTY_TIER', null],
      ['NOTIFY_MANAGER', 'ESCALATED', 'TIER_TIMEOUT', null],
    ]);
    // ESCALATED alerts the organization's Managers and every active TrekLink Staff and Admin account
    // (MSG34, design §3, D-079). The database may hold accounts of other runs, so only this run's are
    // compared.
    const escalation = await prisma.incidentTransition.findFirstOrThrow({
      where: { incidentId: incident.id, toState: 'ESCALATED' },
    });
    const rows = await prisma.alertDelivery.findMany({ where: { transitionId: escalation.id } });
    const mine = [managerId, staffId, secondStaffId, inactiveStaffId, adminId, null];
    expect(
      rows
        .filter((row) => mine.includes(row.recipientId))
        .map((row) => `${row.recipientId ?? 'org'}:${row.tier}:${row.channel}`)
        .sort(),
    ).toEqual(
      [
        `${managerId}:MANAGER:EMAIL`,
        `${managerId}:MANAGER:WEB`,
        `${managerId}:MANAGER:WEBSOCKET`,
        `${staffId}:TREKLINK:EMAIL`,
        `${staffId}:TREKLINK:WEB`,
        `${staffId}:TREKLINK:WEBSOCKET`,
        `${secondStaffId}:TREKLINK:EMAIL`,
        `${secondStaffId}:TREKLINK:WEB`,
        `${secondStaffId}:TREKLINK:WEBSOCKET`,
        `${adminId}:TREKLINK:EMAIL`,
        `${adminId}:TREKLINK:WEB`,
        `${adminId}:TREKLINK:WEBSOCKET`,
        'org:TREKLINK:API_EVENT',
      ].sort(),
    );

    // A deadline fires once: a second run finds nothing due for this incident.
    await job.tierTimeouts();
    expect(await prisma.incidentTransition.count({ where: { incidentId: incident.id } })).toBe(4);
    // and writes no second set of Staff alerts.
    expect(await prisma.alertDelivery.count({ where: { transitionId: escalation.id } })).toBe(
      rows.length,
    );
  });

  it('escalates an owned incident with no status update in time and keeps the owner (REQ-EVT-07)', async () => {
    const incident = await routedIncident();
    const owned = await incidents.acknowledge(
      incident.id,
      { expectedVersion: incident.version },
      caller(),
    );
    expect(owned.statusDueAt).not.toBeNull();

    await job.staleResponses();
    expect((await read(incident.id)).state).toBe('ACKNOWLEDGED');

    await prisma.incident.update({ where: { id: incident.id }, data: { statusDueAt: past() } });
    await job.staleResponses();
    expect(await read(incident.id)).toMatchObject({
      state: 'ESCALATED',
      ownerId: operatorId,
      statusDueAt: null,
    });
    expect((await history(incident.id)).at(-1)).toEqual([
      'ACKNOWLEDGED',
      'ESCALATED',
      'STALE_LIMIT',
      null,
    ]);
  });

  it('closes an ended episode once its reopen window has passed (REQ-EVT-10)', async () => {
    const incident = await routedIncident();
    const ended = await incidents.falseAlarm(
      incident.id,
      { expectedVersion: incident.version, reason: 'Pressed by mistake' },
      caller(),
    );
    expect(ended.reopenWindowEndsAt).not.toBeNull();

    await job.closeAfterReopenWindow();
    expect((await read(incident.id)).state).toBe('FALSE_ALARM');

    await prisma.incident.update({
      where: { id: incident.id },
      data: { reopenWindowEndsAt: past() },
    });
    await job.closeAfterReopenWindow();
    const closed = await read(incident.id);
    expect(closed).toMatchObject({ state: 'CLOSED', reopenWindowEndsAt: null });
    expect(closed.closedAt).not.toBeNull();
    expect((await history(incident.id)).at(-1)).toEqual([
      'FALSE_ALARM',
      'CLOSED',
      'REOPEN_WINDOW_ENDED',
      null,
    ]);
  });

  it('leaves an ended episode whose window was never set (leader ruling on PR #114)', async () => {
    const incident = await routedIncident();
    await incidents.falseAlarm(
      incident.id,
      { expectedVersion: incident.version, reason: 'Pressed by mistake' },
      caller(),
    );
    await prisma.incident.update({
      where: { id: incident.id },
      data: { reopenWindowEndsAt: null },
    });
    await job.closeAfterReopenWindow();
    expect((await read(incident.id)).state).toBe('FALSE_ALARM');
  });
});
