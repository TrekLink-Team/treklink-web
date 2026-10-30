import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AccountType, Incident, IncidentConfidence, IncidentSource } from '@prisma/client';
import { Caller } from '../src/common/decorators/access.decorator';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { AccountsService } from '../src/modules/auth';
import { AccountsRepository } from '../src/modules/auth/accounts.repository';
import { AlertDeliveriesRepository } from '../src/modules/incidents/alert-deliveries.repository';
import { IncidentLifecycle } from '../src/modules/incidents/incident-lifecycle';
import { IncidentsRepository } from '../src/modules/incidents/incidents.repository';
import { IncidentsService } from '../src/modules/incidents/incidents.service';
import { OwnerDeactivationListener } from '../src/modules/incidents/listeners/owner-deactivation.listener';
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

interface Scenario {
  organizationId: string;
  primaryId: string;
  primaryMemberId: string;
  backupId: string | null;
  managerId: string | null;
  shiftId: string;
}

// Owner deactivation against Postgres (incidents 4.2, REQ-EVT-11, D-034). The member's deactivation
// is written as organizations writes it (the account and the member row marked, the shift slot
// cleared), then the listener runs as the member.deactivated event would call it. Each case gets its
// own organization, so its tiers are exactly the ones it sets up. The database may hold TrekLink
// accounts of other runs, so alert rows are compared for this run's accounts only. Run only through
// test:db on a migrated disposable database. Never deletes data.
describe('incident owner deactivation against Postgres', () => {
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
  const listener = new OwnerDeactivationListener(repository, lifecycle, routing, events);
  const incidents = new IncidentsService(repository, lifecycle, parameters, events, {
    memberNames: () => Promise.resolve(new Map<string, string>()),
  } as unknown as OrganizationsService);
  const runId = randomUUID();
  let staffId: string;
  let adminId: string;
  let variantId: string;
  let serial = 0;

  const user = async (name: string, accountType: AccountType) =>
    (
      await prisma.user.create({
        data: {
          email: `deactivation-${name}-${runId}@example.invalid`,
          fullName: `Deactivation ${name}`,
          accountType,
        },
      })
    ).id;

  const member = async (userId: string, organizationId: string, role: 'OPERATOR' | 'MANAGER') =>
    (await prisma.organizationMember.create({ data: { userId, organizationId, role } })).id;

  // An organization whose live shift has the primary, and optionally a backup and a Manager.
  const scenario = async (name: string, tiers: { backup: boolean; manager: boolean }) => {
    const organizationId = (
      await prisma.organization.create({
        data: {
          code: `deactivation-${name}-${runId}`,
          legalName: `Deactivation ${name} organization`,
          taxCode: `d-${name}-${runId}`,
          address: 'Test only',
          contactEmail: 'test@example.invalid',
          contactPhone: '0000000000',
          documentsSeen: [],
          status: 'ACTIVE',
        },
      })
    ).id;
    const primaryId = await user(`${name}-primary`, AccountType.ORGANIZATION);
    const primaryMemberId = await member(primaryId, organizationId, 'OPERATOR');
    const backupId = tiers.backup ? await user(`${name}-backup`, AccountType.ORGANIZATION) : null;
    const backupMemberId = backupId ? await member(backupId, organizationId, 'OPERATOR') : null;
    const managerId = tiers.manager
      ? await user(`${name}-manager`, AccountType.ORGANIZATION)
      : null;
    if (managerId) await member(managerId, organizationId, 'MANAGER');
    const shiftId = (
      await prisma.rosterShift.create({
        data: {
          organizationId,
          startsAt: new Date(Date.now() - 3600_000),
          endsAt: new Date(Date.now() + 3600_000),
          primaryMemberId,
          backupMemberId,
          createdById: managerId ?? staffId,
        },
      })
    ).id;
    return { organizationId, primaryId, primaryMemberId, backupId, managerId, shiftId };
  };

  // An incident routed to the scenario's primary, who acknowledges it and optionally responds.
  const ownedIncident = async (
    s: Scenario,
    state: 'ACKNOWLEDGED' | 'RESPONDING',
  ): Promise<Incident> => {
    serial += 1;
    const device = await prisma.device.create({
      data: {
        assetTag: `deact-${runId.slice(0, 8)}-${serial}`,
        nodeNum: BigInt(`0x${randomUUID().slice(0, 8)}`),
        hardwareVariantId: variantId,
        firmwareVersion: 'test-only',
        acquiredAt: new Date(Date.now() - 86_400_000),
        registeredById: staffId,
        status: 'RENTED',
      },
    });
    const routed = await events.transaction(async (tx) => {
      const now = new Date();
      const { incident } = await repository.insert(
        {
          deviceId: device.id,
          source: IncidentSource.DEVICE_SOS,
          confidence: IncidentConfidence.CONFIRMED,
          firstEventAt: now,
          lastEventAt: now,
          organizationId: s.organizationId,
        },
        now,
        tx,
      );
      const route = await routing.route(
        { organizationId: s.organizationId, contractId: null },
        now,
        tx,
      );
      return lifecycle.apply(
        incident.id,
        'DETECTED',
        route.to,
        { kind: 'SYSTEM' },
        { code: 'ROUTED', at: now, recipients: route.recipients },
        tx,
      );
    });
    const caller: Caller = {
      id: s.primaryId,
      roles: ['ORG_OPERATOR'],
      organizationId: s.organizationId,
    };
    const owned = await incidents.acknowledge(
      routed.id,
      { expectedVersion: routed.version },
      caller,
    );
    if (state === 'ACKNOWLEDGED') return owned;
    return incidents.responding(
      owned.id,
      { expectedVersion: owned.version, note: 'On the way' },
      caller,
    );
  };

  // What organizations commits before it emits member.deactivated.
  const deactivatePrimary = async (s: Scenario) => {
    await prisma.user.update({ where: { id: s.primaryId }, data: { isActive: false } });
    await prisma.organizationMember.update({
      where: { id: s.primaryMemberId },
      data: { deactivatedAt: new Date() },
    });
    await prisma.rosterShift.update({ where: { id: s.shiftId }, data: { primaryMemberId: null } });
  };

  const history = async (id: string) =>
    (
      await prisma.incidentTransition.findMany({
        where: { incidentId: id },
        orderBy: { seq: 'asc' },
      })
    ).map((row) => [row.fromState, row.toState, row.reason, row.actorId]);

  // The person recipients of the incident's last transition, as `recipient:tier`, for the given ids.
  const lastAlerts = async (incidentId: string, ids: (string | null)[]) => {
    const last = await prisma.incidentTransition.findFirstOrThrow({
      where: { incidentId },
      orderBy: { seq: 'desc' },
    });
    const rows = await prisma.alertDelivery.findMany({
      where: { transitionId: last.id, recipientId: { not: null } },
    });
    return [
      ...new Set(
        rows
          .filter((row) => ids.includes(row.recipientId))
          .map((r) => `${r.recipientId}:${r.tier}`),
      ),
    ].sort();
  };

  beforeAll(async () => {
    await prisma.$connect();
    staffId = await user('staff', AccountType.TREKLINK);
    adminId = await user('admin', AccountType.TREKLINK);
    const staffRole = await prisma.role.findUniqueOrThrow({ where: { key: 'STAFF' } });
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { key: 'ADMIN' } });
    await prisma.userRole.createMany({
      data: [
        { userId: staffId, roleId: staffRole.id },
        { userId: adminId, roleId: adminRole.id },
      ],
    });
    variantId = (
      await prisma.hardwareVariant.create({
        data: {
          code: `deactivation-${runId}`,
          name: 'Deactivation variant',
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

  it('returns an acknowledged incident of a deactivated owner to NOTIFY_BACKUP and alerts the backup', async () => {
    const s = await scenario('ack', { backup: true, manager: true });
    const incident = await ownedIncident(s, 'ACKNOWLEDGED');
    await deactivatePrimary(s);

    await expect(listener.onMemberDeactivated({ userId: s.primaryId })).resolves.toBe(1);

    const moved = await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } });
    expect(moved).toMatchObject({ state: 'NOTIFY_BACKUP', ownerId: null });
    expect(moved.tierDeadlineAt).not.toBeNull();
    expect((await history(incident.id)).at(-1)).toEqual([
      'ACKNOWLEDGED',
      'NOTIFY_BACKUP',
      'OWNER_DEACTIVATED',
      null,
    ]);
    expect(await lastAlerts(incident.id, [s.backupId, s.managerId, staffId, adminId])).toEqual([
      `${s.backupId}:BACKUP`,
    ]);

    // The event delivered twice moves nothing more.
    await expect(listener.onMemberDeactivated({ userId: s.primaryId })).resolves.toBe(0);
  });

  it('moves a RESPONDING incident past an empty backup tier to NOTIFY_MANAGER', async () => {
    const s = await scenario('responding', { backup: false, manager: true });
    const incident = await ownedIncident(s, 'RESPONDING');
    expect(incident.state).toBe('RESPONDING');
    await deactivatePrimary(s);

    await expect(listener.onMemberDeactivated({ userId: s.primaryId })).resolves.toBe(1);

    expect(await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } })).toMatchObject({
      state: 'NOTIFY_MANAGER',
      ownerId: null,
    });
    expect((await history(incident.id)).slice(-2)).toEqual([
      ['RESPONDING', 'NOTIFY_BACKUP', 'OWNER_DEACTIVATED', null],
      ['NOTIFY_BACKUP', 'NOTIFY_MANAGER', 'EMPTY_TIER', null],
    ]);
    expect(await lastAlerts(incident.id, [s.managerId, staffId, adminId])).toEqual([
      `${s.managerId}:MANAGER`,
    ]);
  });

  it('reaches ESCALATED with the TrekLink Staff and Admin alerted when every tier is empty (REQ-EVT-04)', async () => {
    const s = await scenario('empty', { backup: false, manager: false });
    const incident = await ownedIncident(s, 'ACKNOWLEDGED');
    await deactivatePrimary(s);

    await expect(listener.onMemberDeactivated({ userId: s.primaryId })).resolves.toBe(1);

    expect(await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } })).toMatchObject({
      state: 'ESCALATED',
      ownerId: null,
    });
    expect((await history(incident.id)).slice(-3)).toEqual([
      ['ACKNOWLEDGED', 'NOTIFY_BACKUP', 'OWNER_DEACTIVATED', null],
      ['NOTIFY_BACKUP', 'NOTIFY_MANAGER', 'EMPTY_TIER', null],
      ['NOTIFY_MANAGER', 'ESCALATED', 'EMPTY_TIER', null],
    ]);
    expect(await lastAlerts(incident.id, [staffId, adminId])).toEqual(
      [`${staffId}:TREKLINK`, `${adminId}:TREKLINK`].sort(),
    );
  });
});
