import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AccountType, IncidentConfidence, IncidentSource } from '@prisma/client';
import { Caller } from '../src/common/decorators/access.decorator';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { AccountsService } from '../src/modules/auth';
import { AccountsRepository } from '../src/modules/auth/accounts.repository';
import { AlertDeliveriesRepository } from '../src/modules/incidents/alert-deliveries.repository';
import { AlertDispatcherJob } from '../src/modules/incidents/alerts/alert-dispatcher.job';
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
import type { StaleAlerts } from '../src/modules/incidents/alerts/stale-alerts';

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
  const runId = randomUUID();
  let organizationId: string;
  let operatorId: string;
  let managerId: string;
  let variantId: string;
  let staffId: string;
  let secondStaffId: string;
  let inactiveStaffId: string;
  let deletedStaffId: string;
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

  const emailDispatcher = (send: (message: { to: string }) => Promise<void>, maxAttempts = 4) =>
    new AlertDispatcherJob(
      new AlertDeliveriesRepository(),
      { assetTags: () => Promise.resolve(new Map()) } as never,
      { holderLabels: () => Promise.resolve(new Map()) } as never,
      {
        get: (key: string) =>
          Promise.resolve(key === 'incidents.alertMaxAttempts' ? maxAttempts : 5),
      } as never,
      events,
      new EventEmitter2(),
      accounts,
      { send },
    );

  const emailOf = (incidentId: string) =>
    prisma.alertDelivery.findFirstOrThrow({
      where: { incidentId, recipientId: operatorId, channel: 'EMAIL' },
    });
  const dueEmail = async (incidentId: string) => {
    const row = await emailOf(incidentId);
    // Prioritize this run's row without changing another suite's data.
    await prisma.alertDelivery.update({
      where: { id: row.id },
      data: { nextAttemptAt: new Date(0) },
    });
    return row;
  };

  beforeAll(async () => {
    await prisma.$connect();
    staffId = await user('staff', AccountType.TREKLINK);
    secondStaffId = await user('second-staff', AccountType.TREKLINK);
    inactiveStaffId = await user('inactive-staff', AccountType.TREKLINK);
    deletedStaffId = await user('deleted-staff', AccountType.TREKLINK);
    adminId = await user('admin', AccountType.TREKLINK);
    const staffRole = await prisma.role.findUniqueOrThrow({ where: { key: 'STAFF' } });
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { key: 'ADMIN' } });
    await prisma.userRole.createMany({
      data: [
        ...[staffId, secondStaffId, inactiveStaffId, deletedStaffId].map((userId) => ({
          userId,
          roleId: staffRole.id,
        })),
        { userId: adminId, roleId: adminRole.id },
      ],
    });
    await prisma.user.update({ where: { id: inactiveStaffId }, data: { isActive: false } });
    // Soft-deleted but still flagged active, so only the deletedAt filter keeps it out (FR-AUTH-09).
    await prisma.user.update({ where: { id: deletedStaffId }, data: { deletedAt: new Date() } });
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

  it('AC-07: three failed emails back off while escalation continues, then delivery succeeds once', async () => {
    const incident = await routedIncident();
    let failures = 0;
    const send = jest.fn(({ to }: { to: string }) => {
      if (to === `timers-operator-${runId}@example.invalid` && failures++ < 3)
        return Promise.reject(new Error('SMTP unavailable'));
      return Promise.resolve();
    });
    const dispatcher = emailDispatcher(send);
    const original = await dueEmail(incident.id);
    for (let attempt = 1; attempt <= 3; attempt++) {
      const started = Date.now();
      await dispatcher.deliverEmailAlerts();
      const failed = await emailOf(incident.id);
      expect(failed).toMatchObject({
        status: 'PENDING',
        attempts: attempt,
        lastError: 'SMTP unavailable',
        sentAt: null,
      });
      expect(failed.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(started + 5000 * 2 ** attempt);
      expect((await read(incident.id)).state).toBe(
        attempt === 1 ? 'NOTIFY_PRIMARY' : 'NOTIFY_MANAGER',
      );
      if (attempt === 1) {
        await prisma.incident.update({
          where: { id: incident.id },
          data: { tierDeadlineAt: past() },
        });
        await job.tierTimeouts();
        expect((await read(incident.id)).state).toBe('NOTIFY_MANAGER');
      }
      await dueEmail(incident.id);
    }
    await prisma.incident.update({ where: { id: incident.id }, data: { tierDeadlineAt: past() } });
    await job.tierTimeouts();
    expect((await read(incident.id)).state).toBe('ESCALATED');
    await dispatcher.deliverEmailAlerts();
    expect(await emailOf(incident.id)).toMatchObject({
      id: original.id,
      status: 'SENT',
      attempts: 4,
    });
    expect((await emailOf(incident.id)).sentAt).toBeInstanceOf(Date);
    expect(
      await prisma.alertDelivery.count({
        where: { transitionId: original.transitionId, recipientId: operatorId, channel: 'EMAIL' },
      }),
    ).toBe(1);
    const sentCalls = send.mock.calls.filter(
      ([message]) => message.to === `timers-operator-${runId}@example.invalid`,
    ).length;
    await dispatcher.deliverEmailAlerts();
    expect(
      send.mock.calls.filter(
        ([message]) => message.to === `timers-operator-${runId}@example.invalid`,
      ),
    ).toHaveLength(sentCalls);
    expect(
      await prisma.alertDelivery.count({
        where: { incidentId: incident.id, channel: 'API_EVENT', status: 'SENT' },
      }),
    ).toBe(0);
  });

  it('settles a terminal email failure and exposes its attempts/error in the delivery log', async () => {
    const incident = await routedIncident();
    const dispatcher = emailDispatcher(() => Promise.reject(new Error('SMTP unavailable')), 1);
    await dueEmail(incident.id);
    await dispatcher.deliverEmailAlerts();
    expect(await emailOf(incident.id)).toMatchObject({
      status: 'FAILED',
      attempts: 1,
      lastError: 'SMTP unavailable',
      sentAt: null,
    });
    expect(await repository.alertDeliveries(incident.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channel: 'EMAIL',
          status: 'FAILED',
          attempts: 1,
          lastError: 'SMTP unavailable',
        }),
      ]),
    );
    expect((await read(incident.id)).state).toBe('NOTIFY_PRIMARY');
  });

  it('does not lock the incident while SMTP is pending, and concurrent dispatch skips the claimed email', async () => {
    const incident = await routedIncident();
    await dueEmail(incident.id);
    let release!: () => void;
    let entered!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sending = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const send = jest.fn(async () => {
      entered();
      await pending;
    });
    const first = emailDispatcher(send).deliverEmailAlerts();
    try {
      await sending;
      await prisma.incident.update({
        where: { id: incident.id },
        data: { tierDeadlineAt: past() },
      });
      await job.tierTimeouts();
      expect((await read(incident.id)).state).toBe('NOTIFY_MANAGER');
      const secondSend = jest.fn(() => Promise.resolve());
      await emailDispatcher(secondSend).deliverEmailAlerts();
      expect(secondSend.mock.calls).not.toEqual(
        expect.arrayContaining([
          [expect.objectContaining({ to: `timers-operator-${runId}@example.invalid` })],
        ]),
      );
    } finally {
      release();
      await first;
    }
    expect(await emailOf(incident.id)).toMatchObject({ status: 'SENT', attempts: 1 });
  });

  // Review of #214: a 6 s send inside the claim transaction outlived Prisma's 5 s default, so
  // nothing settled and the next run sent the email again.
  it('settles a send slower than the 5 s transaction default once, and the next run skips it', async () => {
    const incident = await routedIncident();
    await dueEmail(incident.id);
    const operator = `timers-operator-${runId}@example.invalid`;
    const send = jest.fn(({ to }: { to: string }) =>
      to === operator
        ? new Promise<void>((resolve) => setTimeout(resolve, 6000))
        : Promise.resolve(),
    );
    const dispatcher = emailDispatcher(send);
    await dispatcher.deliverEmailAlerts();
    expect(await emailOf(incident.id)).toMatchObject({ status: 'SENT', attempts: 1 });
    await dispatcher.deliverEmailAlerts();
    expect(send.mock.calls.filter(([message]) => message.to === operator)).toHaveLength(1);
  }, 20000);

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
    // (MSG34, design §3, D-079); an inactive or soft-deleted account gets nothing. The database may hold
    // accounts of other runs, so only this run's are compared.
    const escalation = await prisma.incidentTransition.findFirstOrThrow({
      where: { incidentId: incident.id, toState: 'ESCALATED' },
    });
    const rows = await prisma.alertDelivery.findMany({ where: { transitionId: escalation.id } });
    const mine = [
      managerId,
      staffId,
      secondStaffId,
      inactiveStaffId,
      deletedStaffId,
      adminId,
      null,
    ];
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
