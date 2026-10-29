import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  AccountType,
  AlertChannel,
  AlertStatus,
  IncidentConfidence,
  IncidentSource,
  IncidentState,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { AlertDeliveriesRepository } from '../src/modules/incidents/alert-deliveries.repository';
import { AuthorityReportsRepository } from '../src/modules/incidents/authority-reports.repository';
import { IncidentsRepository, NewIncident } from '../src/modules/incidents/incidents.repository';
import {
  IncidentActor,
  IncidentLifecycle,
  IncidentRecipients,
  IncidentTransitionReason,
} from '../src/modules/incidents/incident-lifecycle';
import { IncidentsService } from '../src/modules/incidents/incidents.service';
import { OrganizationsService } from '../src/modules/organizations';
import { Caller } from '../src/common/decorators/access.decorator';
import { TransactionalEvents } from '../src/modules/platform/events/emit-after-commit';
import { ParameterService } from '../src/modules/platform/parameters/parameter.service';
import { ParameterRepository } from '../src/modules/platform/parameters/parameter.repository';
import { ValidatedEnvironment } from '../src/modules/platform/config/environment-variables';
import { ErrorCode } from '../src/common/errors';

// Capture explicit connection settings before Prisma can load a local .env at construction.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !process.env.DATABASE_DIRECT_URL) {
  throw new Error('test:db requires explicit DATABASE_URL and DATABASE_DIRECT_URL.');
}

// Run only through test:db against a migrated disposable database. Never deletes data.
// Fixtures carry a fresh run ID; the local container or CI service is discarded after verification.
describe('incident foundation against Postgres (REQ-UBI-02, BR-13)', () => {
  const prisma = new PrismaService({ datasourceUrl: databaseUrl });
  const repository = new IncidentsRepository(prisma);
  const organizations = { memberNames: () => Promise.resolve(new Map<string, string>()) };
  const alerts = new AlertDeliveriesRepository();
  const reports = new AuthorityReportsRepository();
  const emitter = new EventEmitter2();
  const events = new TransactionalEvents(prisma, emitter);
  const parameters = new ParameterService(
    new ParameterRepository(prisma),
    events,
    new ConfigService<ValidatedEnvironment, true>({ PARAMETER_CACHE_TTL_SECONDS: 0 }),
  );
  const lifecycle = new IncidentLifecycle(repository, alerts, parameters, events);
  const at = new Date('2026-10-23T09:00:00Z');
  const runId = randomUUID();
  let staffId: string;
  let variantId: string;
  let organizationId: string;
  let operatorId: string;
  let secondOperatorId: string;
  let serial = 0;

  const input = (deviceId: string): NewIncident => ({
    deviceId,
    source: IncidentSource.DEVICE_SOS,
    confidence: IncidentConfidence.CONFIRMED,
    firstEventAt: at,
    lastEventAt: at,
  });

  const device = async () => {
    serial += 1;
    return prisma.device.create({
      data: {
        assetTag: `incident-test-${runId}-${serial}`,
        // Random 32-bit test radio identity.
        nodeNum: BigInt(`0x${randomUUID().slice(0, 8)}`),
        hardwareVariantId: variantId,
        firmwareVersion: 'test-only',
        acquiredAt: at,
        registeredById: staffId,
      },
    });
  };

  beforeAll(async () => {
    await prisma.$connect();
    staffId = (
      await prisma.user.create({
        data: {
          email: `incident-test-${runId}@example.invalid`,
          fullName: 'Incident test staff',
          accountType: AccountType.TREKLINK,
        },
      })
    ).id;
    variantId = (
      await prisma.hardwareVariant.create({
        data: {
          code: `incident-test-${runId}`,
          name: 'Incident test variant',
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
          code: `lifecycle-${runId}`,
          legalName: 'Lifecycle test organization',
          taxCode: runId,
          address: 'Test only',
          contactEmail: 'test@example.invalid',
          contactPhone: '0000000000',
          documentsSeen: [],
        },
      })
    ).id;
    const users = await Promise.all(
      ['operator', 'second'].map((name) =>
        prisma.user.create({
          data: {
            email: `${name}-${runId}@example.invalid`,
            fullName: `Test ${name}`,
            accountType: AccountType.ORGANIZATION,
          },
        }),
      ),
    );
    operatorId = users[0].id;
    secondOperatorId = users[1].id;
  });

  afterAll(async () => prisma.$disconnect());
  beforeEach(() => emitter.removeAllListeners());

  const member = (id = operatorId): IncidentActor => ({
    kind: 'MEMBER',
    id,
    organizationId,
    roles: ['ORG_OPERATOR'],
  });
  const recipients = (): IncidentRecipients => ({
    primary: [operatorId],
    backup: [secondOperatorId],
    managers: [operatorId],
    staff: [staffId],
  });
  const reason = (
    code: IncidentTransitionReason['code'],
    extra: Partial<IncidentTransitionReason> = {},
  ): IncidentTransitionReason => ({
    code,
    at,
    recipients: recipients(),
    expectedVersion: 0,
    ...extra,
  });
  const fixture = async (
    state: IncidentState,
    patch: Partial<Prisma.IncidentUncheckedCreateInput> = {},
  ) => {
    const { id } = await device();
    const incident = await prisma.incident.create({
      data: {
        ...input(id),
        code: `lifecycle-${randomUUID()}`,
        state,
        organizationId,
        stateChangedAt: new Date(at.getTime() - 60000),
        tierDeadlineAt: new Date(at.getTime() - 1),
        ...patch,
      },
    });
    await prisma.incidentTransition.create({
      data: { incidentId: incident.id, seq: 1, toState: state, reason: 'TEST_FIXTURE' },
    });
    return incident;
  };

  it('ten concurrent inserts correlate to exactly one open incident', async () => {
    const { id } = await device();
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        prisma.$transaction((tx) => repository.insert(input(id), at, tx), {
          maxWait: 15000,
          timeout: 15000,
        }),
      ),
    );
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result.incident.id)).size).toBe(1);
    expect(await prisma.incident.count({ where: { deviceId: id } })).toBe(1);
  });

  it('allocates unique six-digit codes for concurrent different devices', async () => {
    const devices = await Promise.all(Array.from({ length: 10 }, () => device()));
    const results = await Promise.all(
      devices.map(({ id }) =>
        prisma.$transaction((tx) => repository.insert(input(id), at, tx), {
          maxWait: 15000,
          timeout: 15000,
        }),
      ),
    );
    expect(results.every((result) => result.created)).toBe(true);
    expect(new Set(results.map((result) => result.incident.code)).size).toBe(10);
    for (const result of results) expect(result.incident.code).toMatch(/^INC-2026-\d{6}$/);
  });

  it.each(Object.values(IncidentState).filter((state) => state !== IncidentState.CLOSED))(
    'correlates to an existing %s incident and keeps its transaction usable',
    async (state) => {
      const { id } = await device();
      const original = await prisma.incident.create({
        data: { ...input(id), code: `fixture-${runId}-${state}`, state },
      });
      await prisma.$transaction(async (tx) => {
        const result = await repository.insert(input(id), at, tx);
        expect(result).toEqual({ incident: original, created: false });
        const report = await reports.insert(
          {
            incidentId: result.incident.id,
            agency: 'Test authority',
            reference: `test-${state}`,
            reportedAt: at,
            reportedById: staffId,
          },
          tx,
        );
        expect(await tx.authorityReport.findUnique({ where: { id: report.id } })).not.toBeNull();
      });
      expect(await prisma.authorityReport.count({ where: { incidentId: original.id } })).toBe(1);
    },
  );

  it('allows another incident after CLOSED and does not lock the closed row as open', async () => {
    const { id } = await device();
    await prisma.incident.create({
      data: { ...input(id), code: `fixture-${runId}-closed`, state: IncidentState.CLOSED },
    });
    await prisma.$transaction(async (tx) => {
      expect(await repository.lockOpenByDevice(id, tx)).toBeNull();
      const result = await repository.insert(input(id), at, tx);
      expect(result.created).toBe(true);
      expect(await repository.lockOpenByDevice(id, tx)).toEqual(result.incident);
    });
    expect(await prisma.incident.count({ where: { deviceId: id } })).toBe(2);
  });

  it('rolls back incident, transition, outbox and authority report together', async () => {
    const { id } = await device();
    const aborted = new Error('test rollback');
    let incidentId = '';
    await expect(
      prisma.$transaction(async (tx) => {
        const result = await repository.insert(input(id), at, tx);
        incidentId = result.incident.id;
        const transition = await tx.incidentTransition.create({
          data: { incidentId, seq: 1, toState: IncidentState.DETECTED, reason: 'CREATED' },
        });
        await alerts.enqueue(
          [
            {
              incidentId,
              transitionId: transition.id,
              tier: 'TREKLINK',
              recipientId: staffId,
              channel: AlertChannel.WEB,
            },
          ],
          tx,
        );
        await reports.insert(
          {
            incidentId,
            agency: 'Test authority',
            reference: 'rollback',
            reportedAt: at,
            reportedById: staffId,
          },
          tx,
        );
        expect(await tx.alertDelivery.count({ where: { incidentId } })).toBe(1);
        throw aborted;
      }),
    ).rejects.toBe(aborted);
    expect(await prisma.incident.findUnique({ where: { id: incidentId } })).toBeNull();
    expect(await prisma.incidentTransition.count({ where: { incidentId } })).toBe(0);
    expect(await prisma.alertDelivery.count({ where: { incidentId } })).toBe(0);
    expect(await prisma.authorityReport.count({ where: { incidentId } })).toBe(0);
  });

  it('persists a pending API outbox row with schema defaults on commit', async () => {
    const { id } = await device();
    const incidentId = await prisma.$transaction(async (tx) => {
      const { incident } = await repository.insert(input(id), at, tx);
      const transition = await tx.incidentTransition.create({
        data: {
          incidentId: incident.id,
          seq: 1,
          toState: IncidentState.DETECTED,
          reason: 'CREATED',
        },
      });
      await alerts.enqueue(
        [
          {
            incidentId: incident.id,
            transitionId: transition.id,
            tier: 'TREKLINK',
            recipientId: null,
            channel: AlertChannel.API_EVENT,
          },
        ],
        tx,
      );
      return incident.id;
    });
    const row = await prisma.alertDelivery.findFirstOrThrow({ where: { incidentId } });
    expect(row).toMatchObject({ status: AlertStatus.PENDING, attempts: 0, sentAt: null });
    expect(row.nextAttemptAt).toBeInstanceOf(Date);
  });

  it('preserves a foreign-key error and restores the savepoint before subsequent writes', async () => {
    const { id } = await device();
    await prisma.$transaction(async (tx) => {
      await expect(repository.insert(input(randomUUID()), at, tx)).rejects.toMatchObject({
        code: 'P2003',
      } satisfies Partial<Prisma.PrismaClientKnownRequestError>);
      expect((await repository.insert(input(id), at, tx)).created).toBe(true);
    });
  });

  it.each(['NOTIFY_PRIMARY', 'ESCALATED', 'REPORTED'] as const)(
    'two concurrent acknowledgements from %s produce one owner, one transition and one stream row',
    async (state) => {
      const incident = await fixture(state, {
        ownerId: state === 'NOTIFY_PRIMARY' ? null : operatorId,
      });
      const changed = jest.fn();
      emitter.on('incident.changed', changed);
      const results = await Promise.allSettled(
        [operatorId, secondOperatorId].map((id) =>
          events.transaction((tx) =>
            lifecycle.apply(
              incident.id,
              state,
              'ACKNOWLEDGED',
              member(id),
              reason('ACKNOWLEDGED'),
              tx,
            ),
          ),
        ),
      );
      const won = results.filter((result) => result.status === 'fulfilled');
      const lost = results.filter((result) => result.status === 'rejected');
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      expect(lost[0]).toMatchObject({ reason: { errorCode: ErrorCode.ALREADY_OWNED } });
      const saved = await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } });
      expect([operatorId, secondOperatorId]).toContain(saved.ownerId);
      expect(saved.state).toBe('ACKNOWLEDGED');
      expect(saved.statusDueAt).toEqual(
        new Date(at.getTime() + (await parameters.get('incidents.staleLimitMinutes')) * 60000),
      );
      expect(saved.tierDeadlineAt).toBeNull();
      expect(changed).toHaveBeenCalledTimes(1);
      expect(
        await prisma.incidentTransition.findMany({
          where: { incidentId: incident.id },
          orderBy: { seq: 'asc' },
          select: { seq: true },
        }),
      ).toEqual([{ seq: 1 }, { seq: 2 }]);
      expect(await prisma.alertDelivery.count({ where: { incidentId: incident.id } })).toBe(1);
    },
  );

  it.each(['ACKNOWLEDGED', 'RESPONDING'] as const)(
    'a different Manager takes over after stale escalation from %s',
    async (state) => {
      const firstAcknowledgedAt = new Date(at.getTime() - 60000);
      const incident = await fixture(state, {
        ownerId: operatorId,
        acknowledgedAt: firstAcknowledgedAt,
        statusDueAt: new Date(at.getTime() - 1),
      });
      const targets = { ...recipients(), managers: [secondOperatorId] };
      const escalated = await events.transaction((tx) =>
        lifecycle.apply(
          incident.id,
          state,
          'ESCALATED',
          { kind: 'SYSTEM' },
          reason('STALE_LIMIT', { recipients: targets }),
          tx,
        ),
      );
      expect(escalated.ownerId).toBe(operatorId);
      const manager: IncidentActor = {
        kind: 'MEMBER',
        id: secondOperatorId,
        organizationId,
        roles: ['ORG_MANAGER'],
      };
      const takeover = await events.transaction((tx) =>
        lifecycle.apply(
          incident.id,
          'ESCALATED',
          'ACKNOWLEDGED',
          manager,
          reason('ACKNOWLEDGED', { expectedVersion: 1, recipients: targets }),
          tx,
        ),
      );
      expect(takeover).toMatchObject({
        state: 'ACKNOWLEDGED',
        ownerId: secondOperatorId,
        version: 2,
        acknowledgedAt: firstAcknowledgedAt,
      });
      expect(takeover.statusDueAt).toEqual(
        new Date(at.getTime() + (await parameters.get('incidents.staleLimitMinutes')) * 60000),
      );
      expect(await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } })).toEqual(
        takeover,
      );
      expect(
        await prisma.incidentTransition.findMany({
          where: { incidentId: incident.id },
          orderBy: { seq: 'asc' },
          select: { seq: true, toState: true, actorId: true },
        }),
      ).toEqual([
        { seq: 1, toState: state, actorId: null },
        { seq: 2, toState: 'ESCALATED', actorId: null },
        { seq: 3, toState: 'ACKNOWLEDGED', actorId: secondOperatorId },
      ]);
    },
  );

  it('a timer waiting behind an acknowledgement loses without escalating', async () => {
    const incident = await fixture('NOTIFY_PRIMARY');
    let signalLocked!: () => void;
    let release!: () => void;
    const locked = new Promise<void>((resolve) => {
      signalLocked = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const acknowledgement = events.transaction(async (tx) => {
      const result = await lifecycle.apply(
        incident.id,
        'NOTIFY_PRIMARY',
        'ACKNOWLEDGED',
        member(),
        reason('ACKNOWLEDGED'),
        tx,
      );
      signalLocked();
      await gate;
      return result;
    });
    await locked;
    const timer = events.transaction((tx) =>
      lifecycle.apply(
        incident.id,
        'NOTIFY_PRIMARY',
        'NOTIFY_BACKUP',
        { kind: 'SYSTEM' },
        reason('TIER_TIMEOUT'),
        tx,
      ),
    );
    // Attach the rejection handler before allowing the competing transaction to finish.
    const timerResult = expect(timer).rejects.toMatchObject({ errorCode: ErrorCode.STALE_VERSION });
    release();
    await acknowledgement;
    await timerResult;
    expect(await prisma.incidentTransition.count({ where: { incidentId: incident.id } })).toBe(2);
    expect((await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } })).state).toBe(
      'ACKNOWLEDGED',
    );
  });

  it('skips empty tiers with consecutive history, pending outbox and events after commit', async () => {
    const incident = await fixture('DETECTED');
    const changed = jest.fn();
    const audited = jest.fn();
    emitter.on('incident.changed', changed);
    emitter.on('audit.record', audited);
    const saved = await events.transaction(async (tx) => {
      const result = await lifecycle.apply(
        incident.id,
        'DETECTED',
        'NOTIFY_PRIMARY',
        { kind: 'SYSTEM' },
        reason('ROUTED', {
          recipients: { ...recipients(), primary: [], backup: [] },
        }),
        tx,
      );
      expect(changed).not.toHaveBeenCalled();
      expect(audited).not.toHaveBeenCalled();
      expect(await tx.alertDelivery.count({ where: { incidentId: incident.id } })).toBe(6);
      return result;
    });
    expect(saved.state).toBe('NOTIFY_MANAGER');
    expect(saved.version).toBe(3);
    expect(saved.tierDeadlineAt).toEqual(
      new Date(at.getTime() + (await parameters.get('incidents.managerAckTimeoutSeconds')) * 1000),
    );
    expect(changed).toHaveBeenCalledTimes(3);
    expect(audited).toHaveBeenCalledTimes(3);
    expect(
      await prisma.incidentTransition.findMany({
        where: { incidentId: incident.id },
        orderBy: { seq: 'asc' },
        select: { seq: true, toState: true },
      }),
    ).toEqual([
      { seq: 1, toState: 'DETECTED' },
      { seq: 2, toState: 'NOTIFY_PRIMARY' },
      { seq: 3, toState: 'NOTIFY_BACKUP' },
      { seq: 4, toState: 'NOTIFY_MANAGER' },
    ]);
    expect(
      await prisma.alertDelivery.count({ where: { incidentId: incident.id, status: 'PENDING' } }),
    ).toBe(6);
  });

  it('discards queued events and all incident/outbox/report writes when the caller rolls back', async () => {
    const incident = await fixture('DETECTED', { organizationId: null });
    const changed = jest.fn();
    const audited = jest.fn();
    emitter.on('incident.changed', changed);
    emitter.on('audit.record', audited);
    const aborted = new Error('caller aborts');
    await expect(
      events.transaction(async (tx) => {
        await lifecycle.apply(
          incident.id,
          'DETECTED',
          'UNROUTED',
          { kind: 'SYSTEM' },
          reason('ROUTED'),
          tx,
        );
        await reports.insert(
          {
            incidentId: incident.id,
            agency: 'Test',
            reference: 'rollback',
            reportedAt: at,
            reportedById: staffId,
          },
          tx,
        );
        throw aborted;
      }),
    ).rejects.toBe(aborted);
    expect(await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } })).toEqual(
      incident,
    );
    expect(await prisma.incidentTransition.count({ where: { incidentId: incident.id } })).toBe(1);
    expect(await prisma.alertDelivery.count({ where: { incidentId: incident.id } })).toBe(0);
    expect(await prisma.authorityReport.count({ where: { incidentId: incident.id } })).toBe(0);
    expect(changed).not.toHaveBeenCalled();
    expect(audited).not.toHaveBeenCalled();
  });

  it('rolls back state and history if the outbox insert fails', async () => {
    const incident = await fixture('DETECTED');
    const error = new Error('outbox unavailable');
    const enqueue = jest.spyOn(alerts, 'enqueue').mockRejectedValueOnce(error);
    try {
      await expect(
        events.transaction((tx) =>
          lifecycle.apply(
            incident.id,
            'DETECTED',
            'NOTIFY_PRIMARY',
            { kind: 'SYSTEM' },
            reason('ROUTED'),
            tx,
          ),
        ),
      ).rejects.toBe(error);
    } finally {
      enqueue.mockRestore();
    }
    expect(await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } })).toEqual(
      incident,
    );
    expect(await prisma.incidentTransition.count({ where: { incidentId: incident.id } })).toBe(1);
    expect(await prisma.alertDelivery.count({ where: { incidentId: incident.id } })).toBe(0);
  });

  it('a reconstructed lifecycle uses persisted deadlines and rejects a repeated timeout', async () => {
    const incident = await fixture('NOTIFY_PRIMARY');
    const restarted = new IncidentLifecycle(repository, alerts, parameters, events);
    const result = await events.transaction((tx) =>
      restarted.apply(
        incident.id,
        'NOTIFY_PRIMARY',
        'NOTIFY_BACKUP',
        { kind: 'SYSTEM' },
        reason('TIER_TIMEOUT'),
        tx,
      ),
    );
    expect(result.state).toBe('NOTIFY_BACKUP');
    expect(result.tierDeadlineAt).toEqual(
      new Date(at.getTime() + (await parameters.get('incidents.backupAckTimeoutSeconds')) * 1000),
    );
    await expect(
      events.transaction((tx) =>
        restarted.apply(
          incident.id,
          'NOTIFY_PRIMARY',
          'NOTIFY_BACKUP',
          { kind: 'SYSTEM' },
          reason('TIER_TIMEOUT'),
          tx,
        ),
      ),
    ).rejects.toMatchObject({ errorCode: ErrorCode.STALE_VERSION });
    expect(await prisma.incidentTransition.count({ where: { incidentId: incident.id } })).toBe(2);
  });

  it('response, resolution and device-triggered reopen share the lifecycle and clear old ownership', async () => {
    const incident = await fixture('ACKNOWLEDGED', {
      ownerId: operatorId,
      acknowledgedAt: at,
      statusDueAt: new Date(at.getTime() + 60000),
    });
    const result = await events.transaction(async (tx) => {
      await lifecycle.apply(
        incident.id,
        'ACKNOWLEDGED',
        'RESPONDING',
        member(),
        reason('RESPONDING'),
        tx,
      );
      await lifecycle.apply(
        incident.id,
        'RESPONDING',
        'RESOLVED',
        member(),
        reason('RESOLVED', { expectedVersion: 1, note: 'Reached safety' }),
        tx,
      );
      return lifecycle.apply(
        incident.id,
        'RESOLVED',
        'NOTIFY_PRIMARY',
        { kind: 'DEVICE' },
        reason('REOPENED', {
          expectedVersion: 2,
          occurredAt: at,
          route: { organizationId, contractId: null },
        }),
        tx,
      );
    });
    expect(result).toMatchObject({
      state: 'NOTIFY_PRIMARY',
      version: 3,
      ownerId: null,
      acknowledgedAt: null,
      resolvedAt: null,
      outcomeNote: null,
      reopenCount: 1,
    });
    expect(await prisma.incidentTransition.count({ where: { incidentId: incident.id } })).toBe(4);
  });

  describe('owner actions through IncidentsService (task 4.1)', () => {
    const service = new IncidentsService(
      repository,
      lifecycle,
      parameters,
      events,
      organizations as unknown as OrganizationsService,
    );
    const caller = (id = operatorId): Caller => ({
      id,
      roles: ['ORG_OPERATOR'],
      organizationId,
    });

    it('AC-03: two members acknowledge at once; one owns it, the other gets ALREADY_OWNED', async () => {
      const incident = await fixture('NOTIFY_PRIMARY');
      const results = await Promise.allSettled(
        [operatorId, secondOperatorId].map((id) =>
          service.acknowledge(incident.id, { expectedVersion: 0 }, caller(id)),
        ),
      );
      const won = results.filter((result) => result.status === 'fulfilled');
      const lost = results.filter((result) => result.status === 'rejected');
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      expect(lost[0]).toMatchObject({ reason: { errorCode: ErrorCode.ALREADY_OWNED } });
      const saved = await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } });
      expect(saved).toMatchObject({ state: 'ACKNOWLEDGED', version: 1 });
      expect([operatorId, secondOperatorId]).toContain(saved.ownerId);
      expect(await prisma.incidentTransition.count({ where: { incidentId: incident.id } })).toBe(2);
    });

    it('a status update resets the deadline without a version bump, so resolve keeps its version', async () => {
      const incident = await fixture('RESPONDING', {
        ownerId: operatorId,
        acknowledgedAt: at,
        statusDueAt: new Date(at.getTime() + 60000),
      });
      const changed = jest.fn();
      emitter.on('incident.changed', changed);
      const before = Date.now();
      const update = await service.addStatus(incident.id, { note: 'Reached the holder' }, caller());
      const staleLimit = (await parameters.get('incidents.staleLimitMinutes')) * 60000;
      expect(update.statusDueAt.getTime()).toBe(update.createdAt.getTime() + staleLimit);
      expect(update.createdAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(changed).toHaveBeenCalledTimes(1);
      const afterUpdate = await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } });
      expect(afterUpdate).toMatchObject({
        state: 'RESPONDING',
        version: 0,
        statusDueAt: update.statusDueAt,
      });
      expect(
        await prisma.incidentStatusUpdate.findMany({
          where: { incidentId: incident.id },
          select: { id: true, authorId: true, note: true },
        }),
      ).toEqual([{ id: update.id, authorId: operatorId, note: 'Reached the holder' }]);
      const resolved = await service.resolve(
        incident.id,
        { expectedVersion: 0, outcomeNote: 'Walked out with assistance' },
        caller(),
      );
      expect(resolved).toMatchObject({
        state: 'RESOLVED',
        version: 1,
        statusDueAt: null,
        outcomeNote: 'Walked out with assistance',
      });
      expect(await prisma.incidentTransition.count({ where: { incidentId: incident.id } })).toBe(2);
    });

    it('refuses a status update from the kept owner after escalation and writes nothing', async () => {
      const incident = await fixture('ESCALATED', { ownerId: operatorId, acknowledgedAt: at });
      await expect(
        service.addStatus(incident.id, { note: 'Still here' }, caller()),
      ).rejects.toMatchObject({ errorCode: ErrorCode.INVALID_STATE_TRANSITION });
      expect(await prisma.incidentStatusUpdate.count({ where: { incidentId: incident.id } })).toBe(
        0,
      );
      expect(await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } })).toEqual(
        incident,
      );
    });
  });
});
