import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AccountType, IncidentConfidence, IncidentSource } from '@prisma/client';
import { Caller } from '../src/common/decorators/access.decorator';
import { PrismaService } from '../src/common/prisma/prisma.service';
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

// Owner deactivation against Postgres (incidents 4.2, REQ-EVT-11, D-034). The member's deactivation
// is written as organizations writes it (the member row marked, the shift slot cleared), then the
// listener runs as the member.deactivated event would call it. Run only through test:db on a
// migrated disposable database. Never deletes data.
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
  const routing = new RoutingService(new RosterService(new RosterRepository(prisma)));
  const listener = new OwnerDeactivationListener(repository, lifecycle, routing, events);
  const incidents = new IncidentsService(repository, lifecycle, parameters, events, {
    memberNames: () => Promise.resolve(new Map<string, string>()),
  } as unknown as OrganizationsService);
  const runId = randomUUID();
  let organizationId: string;
  let primaryId: string;
  let primaryMemberId: string;
  let backupId: string;
  let managerId: string;
  let staffId: string;
  let shiftId: string;
  let variantId: string;

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

  beforeAll(async () => {
    await prisma.$connect();
    staffId = await user('staff', AccountType.TREKLINK);
    primaryId = await user('primary', AccountType.ORGANIZATION);
    backupId = await user('backup', AccountType.ORGANIZATION);
    managerId = await user('manager', AccountType.ORGANIZATION);
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
    organizationId = (
      await prisma.organization.create({
        data: {
          code: `deactivation-${runId}`,
          legalName: 'Deactivation test organization',
          taxCode: `d-${runId}`,
          address: 'Test only',
          contactEmail: 'test@example.invalid',
          contactPhone: '0000000000',
          documentsSeen: [],
          status: 'ACTIVE',
        },
      })
    ).id;
    primaryMemberId = (
      await prisma.organizationMember.create({
        data: { userId: primaryId, organizationId, role: 'OPERATOR' },
      })
    ).id;
    const backup = await prisma.organizationMember.create({
      data: { userId: backupId, organizationId, role: 'OPERATOR' },
    });
    await prisma.organizationMember.create({
      data: { userId: managerId, organizationId, role: 'MANAGER' },
    });
    shiftId = (
      await prisma.rosterShift.create({
        data: {
          organizationId,
          startsAt: new Date(Date.now() - 3600_000),
          endsAt: new Date(Date.now() + 3600_000),
          primaryMemberId,
          backupMemberId: backup.id,
          createdById: managerId,
        },
      })
    ).id;
  });

  afterAll(async () => prisma.$disconnect());

  it('returns an acknowledged incident of a deactivated owner to NOTIFY_BACKUP and alerts the backup', async () => {
    const device = await prisma.device.create({
      data: {
        assetTag: `deact-${runId.slice(0, 8)}`,
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
    const caller: Caller = { id: primaryId, roles: ['ORG_OPERATOR'], organizationId };
    await incidents.acknowledge(routed.id, { expectedVersion: routed.version }, caller);

    // What organizations commits before it emits member.deactivated.
    const at = new Date();
    await prisma.user.update({ where: { id: primaryId }, data: { isActive: false } });
    await prisma.organizationMember.update({
      where: { id: primaryMemberId },
      data: { deactivatedAt: at },
    });
    await prisma.rosterShift.update({ where: { id: shiftId }, data: { primaryMemberId: null } });

    await expect(listener.onMemberDeactivated({ userId: primaryId })).resolves.toBe(1);

    const incident = await prisma.incident.findUniqueOrThrow({ where: { id: routed.id } });
    expect(incident).toMatchObject({ state: 'NOTIFY_BACKUP', ownerId: null });
    expect(incident.tierDeadlineAt).not.toBeNull();
    const last = await prisma.incidentTransition.findFirstOrThrow({
      where: { incidentId: routed.id },
      orderBy: { seq: 'desc' },
    });
    expect(last).toMatchObject({
      fromState: 'ACKNOWLEDGED',
      toState: 'NOTIFY_BACKUP',
      reason: 'OWNER_DEACTIVATED',
      actorId: null,
    });
    const alerted = await prisma.alertDelivery.findMany({
      where: { transitionId: last.id, recipientId: { not: null } },
    });
    expect(new Set(alerted.map((row) => row.recipientId))).toEqual(new Set([backupId]));

    // The event delivered twice moves nothing more.
    await expect(listener.onMemberDeactivated({ userId: primaryId })).resolves.toBe(0);
  });
});
