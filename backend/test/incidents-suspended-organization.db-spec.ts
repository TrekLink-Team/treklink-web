import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  AccountType,
  AttributionState,
  EventKind,
  IngressPath,
  MemberRole,
  PriorityTier,
  TimeSource,
} from '@prisma/client';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { AccountsService } from '../src/modules/auth';
import { AccountsRepository } from '../src/modules/auth/accounts.repository';
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

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !process.env.DATABASE_DIRECT_URL) {
  throw new Error('test:db requires explicit DATABASE_URL and DATABASE_DIRECT_URL.');
}

// Organizations AC-07 and TC-32 (BR-36): an SOS from a device of a SUSPENDED organization still reaches
// its primary. Neither `RosterService.tiersAt` nor `RoutingService.route` reads the organization status,
// and this suite proves it with a real roster against Postgres, first through the routing and the
// lifecycle and then through `IncidentIngress.onSos`, the entry point that gateway-sync calls (#417).
// Run on migrated disposable Postgres only. Every fixture is unique to the run, so repeated runs delete nothing.
describe('an SOS of a SUSPENDED organization against Postgres (AC-07, BR-36)', () => {
  const prisma = new PrismaService({ datasourceUrl: databaseUrl });
  const events = new TransactionalEvents(prisma, new EventEmitter2());
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
  const lifecycle = new IncidentLifecycle(
    repository,
    new AlertDeliveriesRepository(),
    parameters,
    events,
  );
  const routing = new RoutingService(new RosterService(new RosterRepository(prisma)), accounts);
  const ingress = new IncidentIngress(repository, lifecycle, routing, parameters, events);
  const runId = randomUUID();
  let variantId: string;
  let creatorId: string;
  let serial = 0;

  const user = async (name: string) =>
    (
      await prisma.user.create({
        data: {
          email: `suspended-${name}-${runId}@example.invalid`,
          fullName: `SUSPENDED ${name}`,
          accountType: AccountType.ORGANIZATION,
        },
      })
    ).id;
  const member = async (organizationId: string, userId: string, role: MemberRole) =>
    (await prisma.organizationMember.create({ data: { organizationId, userId, role } })).id;
  const suspendedOrganization = async () =>
    (
      await prisma.organization.create({
        data: {
          code: `suspended-${runId}-${++serial}`,
          legalName: 'Suspended for a default',
          taxCode: `${runId}-${serial}`,
          address: 'Test',
          contactEmail: 'test@example.invalid',
          contactPhone: '0000000000',
          documentsSeen: [],
          status: 'SUSPENDED',
        },
      })
    ).id;
  const device = async () =>
    prisma.device.create({
      data: {
        assetTag: `suspended-${runId}-${++serial}`,
        nodeNum: BigInt(`0x${randomUUID().slice(0, 8)}`),
        hardwareVariantId: variantId,
        firmwareVersion: 'test-only',
        acquiredAt: new Date(),
        registeredById: creatorId,
      },
    });

  // The detection of an SOS attributed to the organization, routed the way ingestion routes it.
  const detectAndRoute = (deviceId: string, organizationId: string) =>
    events.transaction(async (tx) => {
      const at = new Date();
      const { incident } = await repository.insert(
        {
          deviceId,
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
      const routed = await lifecycle.apply(
        incident.id,
        'DETECTED',
        route.to,
        { kind: 'SYSTEM' },
        { code: 'ROUTED', at, recipients: route.recipients },
        tx,
      );
      return { route, routed };
    });

  // The SOS as gateway-sync hands it over: its stored field event (the incident references it) and the
  // attribution at the occurrence time, through `IncidentIngress.onSos` in one transaction.
  const sosThroughIngress = (deviceId: string, organizationId: string) =>
    events.transaction(async (tx) => {
      const occurredAt = new Date();
      const eventId = `suspended-sos-${runId}-${randomUUID()}`;
      await tx.fieldEvent.create({
        data: {
          eventId,
          deviceId,
          organizationId,
          attribution: AttributionState.ATTRIBUTED,
          uplinkKey: '!suspended-sos',
          ingress: IngressPath.MQTT_NODE,
          kind: EventKind.SOS,
          priority: PriorityTier.P0_SOS,
          occurredAt,
          timeSource: TimeSource.DEVICE_RTC,
          payload: {},
        },
      });
      return ingress.onSos(
        { eventId, deviceId, organizationId, contractId: null, source: 'DEVICE_SOS', occurredAt },
        tx,
      );
    });

  const onShift = async (organizationId: string) => {
    const [primaryUser, backupUser] = await Promise.all([user('primary'), user('backup')]);
    const primaryMember = await member(organizationId, primaryUser, MemberRole.OPERATOR);
    const backupMember = await member(organizationId, backupUser, MemberRole.OPERATOR);
    const now = Date.now();
    await prisma.rosterShift.create({
      data: {
        organizationId,
        startsAt: new Date(now - 3_600_000),
        endsAt: new Date(now + 3_600_000),
        primaryMemberId: primaryMember,
        backupMemberId: backupMember,
        createdById: creatorId,
      },
    });
    return { primaryUser, backupUser };
  };

  beforeAll(async () => {
    await prisma.$connect();
    creatorId = await user('creator');
    variantId = (
      await prisma.hardwareVariant.create({
        data: {
          code: `suspended-${runId}`,
          name: 'SUSPENDED test',
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

  it('routes the SOS to the primary of the shift in progress, ahead of the TrekLink accounts', async () => {
    const organizationId = await suspendedOrganization();
    const [primaryUser, backupUser, managerUser] = await Promise.all([
      user('primary'),
      user('backup'),
      user('manager'),
    ]);
    const primaryMember = await member(organizationId, primaryUser, MemberRole.OPERATOR);
    const backupMember = await member(organizationId, backupUser, MemberRole.OPERATOR);
    await member(organizationId, managerUser, MemberRole.MANAGER);
    const now = Date.now();
    await prisma.rosterShift.create({
      data: {
        organizationId,
        startsAt: new Date(now - 3_600_000),
        endsAt: new Date(now + 3_600_000),
        primaryMemberId: primaryMember,
        backupMemberId: backupMember,
        createdById: creatorId,
      },
    });
    const unit = await device();

    const { route, routed } = await detectAndRoute(unit.id, organizationId);

    expect(
      await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } }),
    ).toMatchObject({ status: 'SUSPENDED' });
    expect(route.to).toBe('NOTIFY_PRIMARY');
    expect(route.recipients).toMatchObject({
      primary: [primaryUser],
      backup: [backupUser],
      managers: [managerUser],
      staff: [],
    });
    expect(routed).toMatchObject({ state: 'NOTIFY_PRIMARY', organizationId });
    const transition = await prisma.incidentTransition.findFirstOrThrow({
      where: { incidentId: routed.id, toState: 'NOTIFY_PRIMARY' },
    });
    const rows = await prisma.alertDelivery.findMany({ where: { transitionId: transition.id } });
    const toPrimary = rows.filter((row) => row.recipientId === primaryUser);
    expect(toPrimary.length).toBeGreaterThan(0);
    expect(toPrimary.every((row) => row.tier === 'PRIMARY')).toBe(true);
    expect(rows.some((row) => row.tier === 'TREKLINK')).toBe(false);
  });

  it('still goes to UNROUTED when the suspended organization has nobody to alert', async () => {
    const organizationId = await suspendedOrganization();
    const unit = await device();

    const { route, routed } = await detectAndRoute(unit.id, organizationId);

    expect(route.to).toBe('UNROUTED');
    expect(routed).toMatchObject({ state: 'UNROUTED', organizationId });
  });

  // #417: the same two outcomes through IncidentIngress.onSos, which does not read the organization status.
  it('onSos opens the incident of a SUSPENDED organization and alerts the primary on shift', async () => {
    const organizationId = await suspendedOrganization();
    const { primaryUser } = await onShift(organizationId);
    const unit = await device();

    const incident = await sosThroughIngress(unit.id, organizationId);

    expect(
      await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } }),
    ).toMatchObject({ status: 'SUSPENDED' });
    expect(incident).toMatchObject({
      state: 'NOTIFY_PRIMARY',
      organizationId,
      source: 'DEVICE_SOS',
    });
    const transition = await prisma.incidentTransition.findFirstOrThrow({
      where: { incidentId: incident.id, toState: 'NOTIFY_PRIMARY' },
    });
    const rows = await prisma.alertDelivery.findMany({ where: { transitionId: transition.id } });
    expect(rows.some((row) => row.recipientId === primaryUser && row.tier === 'PRIMARY')).toBe(
      true,
    );
    expect(rows.some((row) => row.tier === 'TREKLINK')).toBe(false);
  });

  it('onSos leaves the incident of a SUSPENDED organization with nobody to alert UNROUTED', async () => {
    const organizationId = await suspendedOrganization();
    const unit = await device();

    const incident = await sosThroughIngress(unit.id, organizationId);

    expect(incident).toMatchObject({ state: 'UNROUTED', organizationId });
  });
});
