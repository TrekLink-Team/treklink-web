import { Incident, IncidentState, Prisma } from '@prisma/client';
import { ErrorCode } from '../../common/errors';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
import {
  IncidentActor,
  IncidentLifecycle,
  IncidentRecipients,
  IncidentTransitionReason,
} from './incident-lifecycle';
import { AlertDeliveriesRepository } from './alert-deliveries.repository';
import { IncidentsRepository } from './incidents.repository';

const AT = new Date('2026-10-24T12:00:00Z');
const BEFORE = new Date(AT.getTime() - 60000);
const AFTER = new Date(AT.getTime() + 60000);
const SYSTEM: IncidentActor = { kind: 'SYSTEM' };
const MEMBER: IncidentActor = {
  kind: 'MEMBER',
  id: 'owner',
  organizationId: 'org-a',
  roles: ['ORG_OPERATOR'],
};
const STAFF: IncidentActor = { kind: 'STAFF', id: 'staff', roles: ['STAFF'] };
const RECIPIENTS: IncidentRecipients = {
  primary: ['primary'],
  backup: ['backup'],
  managers: ['manager'],
  staff: ['staff'],
};
const OPTIONS = { at: AT, recipients: RECIPIENTS };
type Code = IncidentTransitionReason['code'];

const row = (state: IncidentState = 'DETECTED', patch: Partial<Incident> = {}): Incident =>
  ({
    id: 'incident',
    code: 'INC-2026-000001',
    deviceId: 'device',
    organizationId: 'org-a',
    contractId: 'contract-a',
    state,
    version: 7,
    ownerId: null,
    stateChangedAt: BEFORE,
    tierDeadlineAt: BEFORE,
    statusDueAt: BEFORE,
    reopenWindowEndsAt: AFTER,
    acknowledgedAt: null,
    reopenCount: 0,
    ...patch,
  }) as Incident;

// Independent acceptance matrix from D-034 and the two extra NOTIFY_* false-alarm arrows in design §2.
const TARGETS: Partial<Record<IncidentState, Partial<Record<IncidentState, Code>>>> = {
  DETECTED: { NOTIFY_PRIMARY: 'ROUTED', UNROUTED: 'ROUTED' },
  NOTIFY_PRIMARY: {
    NOTIFY_BACKUP: 'TIER_TIMEOUT',
    ACKNOWLEDGED: 'ACKNOWLEDGED',
    FALSE_ALARM: 'FALSE_ALARM',
  },
  NOTIFY_BACKUP: {
    NOTIFY_MANAGER: 'TIER_TIMEOUT',
    ACKNOWLEDGED: 'ACKNOWLEDGED',
    FALSE_ALARM: 'FALSE_ALARM',
  },
  NOTIFY_MANAGER: {
    ESCALATED: 'TIER_TIMEOUT',
    ACKNOWLEDGED: 'ACKNOWLEDGED',
    FALSE_ALARM: 'FALSE_ALARM',
  },
  ACKNOWLEDGED: {
    RESPONDING: 'RESPONDING',
    ESCALATED: 'STALE_LIMIT',
    NOTIFY_BACKUP: 'OWNER_DEACTIVATED',
    RESOLVED: 'RESOLVED',
    FALSE_ALARM: 'FALSE_ALARM',
  },
  RESPONDING: {
    ESCALATED: 'STALE_LIMIT',
    NOTIFY_BACKUP: 'OWNER_DEACTIVATED',
    RESOLVED: 'RESOLVED',
    FALSE_ALARM: 'FALSE_ALARM',
  },
  ESCALATED: { ACKNOWLEDGED: 'ACKNOWLEDGED', REPORTED: 'AUTHORITY_REPORTED' },
  UNROUTED: { REPORTED: 'AUTHORITY_REPORTED', FALSE_ALARM: 'FALSE_ALARM' },
  REPORTED: { ACKNOWLEDGED: 'ACKNOWLEDGED', CLOSED: 'CASE_CLOSED' },
  // A reopen is re-routed as at creation, so it may land in UNROUTED (REQ-EVT-10, REQ-EVT-03).
  RESOLVED: { NOTIFY_PRIMARY: 'REOPENED', UNROUTED: 'REOPENED', CLOSED: 'REOPEN_WINDOW_ENDED' },
  FALSE_ALARM: { NOTIFY_PRIMARY: 'REOPENED', UNROUTED: 'REOPENED', CLOSED: 'REOPEN_WINDOW_ENDED' },
};

describe('IncidentLifecycle task 1.2', () => {
  const tx = {} as Prisma.TransactionClient;
  let current: Incident;
  let repository: { lockById: jest.Mock; compareAndSet: jest.Mock; insertTransition: jest.Mock };
  let alerts: { enqueue: jest.Mock };
  let parameters: { get: jest.Mock };
  let events: { emitAfterCommit: jest.Mock };
  let lifecycle: IncidentLifecycle;

  beforeEach(() => {
    current = row();
    repository = {
      lockById: jest.fn().mockImplementation(() => Promise.resolve(current)),
      compareAndSet: jest
        .fn()
        .mockImplementation(
          (_old: Incident, patch: Partial<Incident> & { reopenCount?: unknown }) => {
            current = {
              ...current,
              ...patch,
              version: current.version + 1,
              reopenCount: patch.reopenCount ? current.reopenCount + 1 : current.reopenCount,
            };
            return Promise.resolve(current);
          },
        ),
      insertTransition: jest.fn().mockResolvedValue({ id: 'transition' }),
    };
    alerts = { enqueue: jest.fn().mockResolvedValue(undefined) };
    parameters = { get: jest.fn().mockResolvedValue(10) };
    events = { emitAfterCommit: jest.fn() };
    lifecycle = new IncidentLifecycle(
      repository as unknown as IncidentsRepository,
      alerts as unknown as AlertDeliveriesRepository,
      parameters as unknown as ParameterService,
      events as unknown as TransactionalEvents,
    );
  });

  const apply = (
    to: IncidentState,
    code: Code,
    actor: IncidentActor = SYSTEM,
    overrides: Partial<IncidentTransitionReason> = {},
  ) =>
    lifecycle.apply(current.id, current.state, to, actor, { ...OPTIONS, code, ...overrides }, tx);

  it.each(
    Object.values(IncidentState).flatMap((from) =>
      Object.values(IncidentState).map((to) => [from, to] as const),
    ),
  )('D-034 pair %s -> %s', async (from, to) => {
    const code = TARGETS[from]?.[to];
    const owned = from === 'ACKNOWLEDGED' || from === 'RESPONDING';
    current = row(from, {
      ownerId: owned ? 'owner' : null,
      reopenWindowEndsAt: to === 'CLOSED' ? BEFORE : AFTER,
    });
    let actor: IncidentActor = SYSTEM;
    if (['ACKNOWLEDGED', 'RESPONDING', 'RESOLVED', 'FALSE_ALARM'].includes(code ?? ''))
      actor = MEMBER;
    if (
      code === 'AUTHORITY_REPORTED' ||
      code === 'CASE_CLOSED' ||
      (from === 'UNROUTED' && to === 'FALSE_ALARM')
    )
      actor = STAFF;
    const work = apply(to, code ?? 'ROUTED', actor, {
      note: 'Outcome or reason',
      occurredAt: AT,
      route: { organizationId: 'org-a', contractId: 'contract-a' },
    });
    if (code) {
      const result = await work;
      expect(result.state).toBe(to);
      expect(result.version).toBe(8);
      if (to.startsWith('NOTIFY_'))
        expect(result.tierDeadlineAt).toEqual(new Date(AT.getTime() + 10000));
      if (to === 'ACKNOWLEDGED' || to === 'RESPONDING') {
        expect(result.ownerId).toBe('owner');
        expect(result.statusDueAt).toEqual(new Date(AT.getTime() + 600000));
      }
      expect(repository.insertTransition).toHaveBeenCalledWith(
        expect.objectContaining({ fromState: from, toState: to, reason: code }),
        tx,
      );
    } else {
      await expect(work).rejects.toMatchObject({ errorCode: ErrorCode.INVALID_STATE_TRANSITION });
      expect(repository.compareAndSet).not.toHaveBeenCalled();
    }
  });

  it('persists timers and history before queueing events, with the same tx', async () => {
    const result = await apply('NOTIFY_PRIMARY', 'ROUTED');
    expect(parameters.get).toHaveBeenCalledWith('incidents.primaryAckTimeoutSeconds', tx);
    expect(repository.compareAndSet).toHaveBeenCalledWith(
      expect.objectContaining({ version: 7, state: 'DETECTED' }),
      expect.objectContaining({
        stateChangedAt: AT,
        statusDueAt: null,
        reopenWindowEndsAt: null,
        ownerId: null,
      }),
      tx,
    );
    expect(alerts.enqueue).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ recipientId: 'primary', channel: 'WEB', tier: 'PRIMARY' }),
        expect.objectContaining({ recipientId: 'primary', channel: 'EMAIL' }),
        expect.objectContaining({ recipientId: 'primary', channel: 'WEBSOCKET' }),
        expect.objectContaining({ recipientId: null, channel: 'API_EVENT' }),
      ]),
      tx,
    );
    expect(events.emitAfterCommit).toHaveBeenCalledWith('incident.changed', {
      incidentId: result.id,
      organizationId: 'org-a',
      state: 'NOTIFY_PRIMARY',
      tier: 'PRIMARY',
      ownerId: null,
    });
    expect(events.emitAfterCommit).toHaveBeenCalledWith(
      'audit.record',
      expect.objectContaining({
        actorId: null,
        actorRoles: [],
        before: { state: 'DETECTED', version: 7, ownerId: null },
        after: { state: 'NOTIFY_PRIMARY', version: 8, ownerId: null, reason: 'ROUTED' },
      }),
    );
    expect(alerts.enqueue.mock.invocationCallOrder[0]).toBeLessThan(
      events.emitAfterCommit.mock.invocationCallOrder[0],
    );
  });

  it.each([
    [
      { primary: [], backup: ['backup'], managers: ['manager'], staff: ['staff'] },
      'NOTIFY_BACKUP',
      2,
    ],
    [{ primary: [], backup: [], managers: ['manager'], staff: ['staff'] }, 'NOTIFY_MANAGER', 3],
    [{ primary: [], backup: [], managers: [], staff: ['staff'] }, 'ESCALATED', 4],
  ] as const)('skips empty tiers atomically to %j', async (recipients, state, transitions) => {
    const result = await apply('NOTIFY_PRIMARY', 'ROUTED', SYSTEM, { recipients });
    expect(result.state).toBe(state);
    expect(result.ownerId).toBeNull();
    expect(repository.insertTransition).toHaveBeenCalledTimes(transitions);
    expect(events.emitAfterCommit).toHaveBeenCalledTimes(transitions * 2);
    if (state === 'ESCALATED') expect(result.tierDeadlineAt).toBeNull();
  });

  it('keeps a silent owner on escalation and deduplicates Manager/Staff recipients', async () => {
    current = row('RESPONDING', { ownerId: 'owner' });
    const result = await apply('ESCALATED', 'STALE_LIMIT', SYSTEM, {
      recipients: { ...RECIPIENTS, managers: ['staff', 'manager', 'manager'] },
    });
    expect(result.ownerId).toBe('owner');
    expect(result.statusDueAt).toBeNull();
    const [deliveries] = alerts.enqueue.mock.calls[0] as [{ recipientId: string | null }[]];
    expect(deliveries).toHaveLength(7);
    expect(deliveries.filter((delivery) => delivery.recipientId === 'staff')).toHaveLength(3);
    expect(alerts.enqueue).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ recipientId: 'manager', tier: 'MANAGER' }),
        expect.objectContaining({ recipientId: 'staff', tier: 'TREKLINK' }),
      ]),
      tx,
    );
  });

  it('writes one row per channel for each active Staff member on a tier timeout to ESCALATED (D-079)', async () => {
    current = row('NOTIFY_MANAGER', { tierDeadlineAt: AT });
    await apply('ESCALATED', 'TIER_TIMEOUT', SYSTEM, {
      recipients: { primary: [], backup: [], managers: ['manager'], staff: ['s-1', 's-2', 's-1'] },
    });
    const [deliveries] = alerts.enqueue.mock.calls[0] as [
      { recipientId: string | null; tier: string; channel: string }[],
    ];
    const keys = deliveries.map((row) => `${row.recipientId ?? 'org'}:${row.tier}:${row.channel}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.sort()).toEqual(
      [
        'manager:MANAGER:EMAIL',
        'manager:MANAGER:WEB',
        'manager:MANAGER:WEBSOCKET',
        's-1:TREKLINK:EMAIL',
        's-1:TREKLINK:WEB',
        's-1:TREKLINK:WEBSOCKET',
        's-2:TREKLINK:EMAIL',
        's-2:TREKLINK:WEB',
        's-2:TREKLINK:WEBSOCKET',
        'org:TREKLINK:API_EVENT',
      ].sort(),
    );
  });

  it('alerts only Staff for an unrouted incident and produces no organization stream row', async () => {
    current = row('DETECTED', { organizationId: null, contractId: null });
    await apply('UNROUTED', 'ROUTED');
    const [deliveries] = alerts.enqueue.mock.calls[0] as [{ recipientId: string | null }[]];
    expect(deliveries).toHaveLength(3);
    expect(deliveries.every((delivery) => delivery.recipientId === 'staff')).toBe(true);
  });

  it('permits an unrouted incident even when no Staff accounts exist', async () => {
    current = row('DETECTED', { organizationId: null });
    await apply('UNROUTED', 'ROUTED', SYSTEM, { recipients: { ...RECIPIENTS, staff: [] } });
    expect(alerts.enqueue).toHaveBeenCalledWith([], tx);
  });

  it.each([null, 'org-b'])(
    'returns 404 for a missing incident or another organization',
    async (organizationId) => {
      if (organizationId === null) repository.lockById.mockResolvedValue(null);
      else current = row('NOTIFY_PRIMARY', { organizationId });
      await expect(apply('ACKNOWLEDGED', 'ACKNOWLEDGED', MEMBER)).rejects.toMatchObject({
        errorCode: ErrorCode.NOT_FOUND,
      });
    },
  );

  it.each(['ACKNOWLEDGED', 'RESPONDING'] as const)(
    'returns ALREADY_OWNED from %s before stale state/version and exposes no cross-tenant ownership',
    async (state) => {
      current = row(state, { ownerId: 'someone-else' });
      await expect(
        lifecycle.apply(
          current.id,
          'NOTIFY_PRIMARY',
          'ACKNOWLEDGED',
          MEMBER,
          { ...OPTIONS, code: 'ACKNOWLEDGED', expectedVersion: 0 },
          tx,
        ),
      ).rejects.toMatchObject({
        errorCode: ErrorCode.ALREADY_OWNED,
        message: 'Another member has already acknowledged this incident.',
      });
      current.organizationId = 'org-b';
      await expect(apply('ACKNOWLEDGED', 'ACKNOWLEDGED', MEMBER)).rejects.toMatchObject({
        errorCode: ErrorCode.NOT_FOUND,
      });
    },
  );

  it('reports a mismatched state or explicit version as STALE_VERSION', async () => {
    await expect(
      lifecycle.apply(
        current.id,
        'UNROUTED',
        'NOTIFY_PRIMARY',
        SYSTEM,
        { ...OPTIONS, code: 'ROUTED' },
        tx,
      ),
    ).rejects.toMatchObject({ errorCode: ErrorCode.STALE_VERSION });
    await expect(
      apply('NOTIFY_PRIMARY', 'ROUTED', SYSTEM, { expectedVersion: 6 }),
    ).rejects.toMatchObject({ errorCode: ErrorCode.STALE_VERSION });
  });

  it('preserves first acknowledgement time when the owner acknowledges an escalated response', async () => {
    current = row('ESCALATED', { ownerId: 'owner', acknowledgedAt: BEFORE });
    expect((await apply('ACKNOWLEDGED', 'ACKNOWLEDGED', MEMBER)).acknowledgedAt).toEqual(BEFORE);
  });

  it.each(['ESCALATED', 'REPORTED'] as const)(
    'allows a different member to take over %s despite a retained owner',
    async (state) => {
      current = row(state, { ownerId: 'silent-operator', acknowledgedAt: BEFORE });
      const manager: IncidentActor = { ...MEMBER, id: 'manager', roles: ['ORG_MANAGER'] };
      const result = await apply('ACKNOWLEDGED', 'ACKNOWLEDGED', manager, { expectedVersion: 7 });
      expect(result).toMatchObject({
        state: 'ACKNOWLEDGED',
        ownerId: 'manager',
        version: 8,
        acknowledgedAt: BEFORE,
      });
      expect(result.statusDueAt).toEqual(new Date(AT.getTime() + 600000));
      expect(repository.insertTransition).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: 'manager', fromState: state, toState: 'ACKNOWLEDGED' }),
        tx,
      );
    },
  );

  it.each(['ESCALATED', 'REPORTED'] as const)(
    'still requires the expected version for takeover from %s',
    async (state) => {
      current = row(state, { ownerId: 'silent-operator' });
      await expect(
        apply('ACKNOWLEDGED', 'ACKNOWLEDGED', MEMBER, { expectedVersion: 6 }),
      ).rejects.toMatchObject({ errorCode: ErrorCode.STALE_VERSION });
      expect(repository.compareAndSet).not.toHaveBeenCalled();
    },
  );

  it('handles a defensive CAS failure by re-reading the row, with owner precedence', async () => {
    repository.compareAndSet.mockResolvedValue(null);
    await expect(apply('NOTIFY_PRIMARY', 'ROUTED')).rejects.toMatchObject({
      errorCode: ErrorCode.STALE_VERSION,
    });
    repository.lockById
      .mockResolvedValueOnce(row('NOTIFY_PRIMARY'))
      .mockResolvedValueOnce(row('ACKNOWLEDGED', { ownerId: 'other' }));
    current = row('NOTIFY_PRIMARY');
    await expect(apply('ACKNOWLEDGED', 'ACKNOWLEDGED', MEMBER)).rejects.toMatchObject({
      errorCode: ErrorCode.ALREADY_OWNED,
    });
    repository.lockById.mockResolvedValueOnce(row()).mockResolvedValueOnce(null);
    current = row();
    await expect(apply('NOTIFY_PRIMARY', 'ROUTED')).rejects.toMatchObject({
      errorCode: ErrorCode.STALE_VERSION,
    });
    expect(repository.insertTransition).not.toHaveBeenCalled();
  });

  it.each(['RESPONDING', 'RESOLVED'] as const)('requires the owner for %s', async (to) => {
    current = row('ACKNOWLEDGED', { ownerId: 'other' });
    await expect(apply(to, to, MEMBER, { note: 'Outcome' })).rejects.toMatchObject({
      errorCode: ErrorCode.NOT_OWNER,
    });
  });

  it.each([
    ['NOTIFY_PRIMARY', 'ACKNOWLEDGED', 'ACKNOWLEDGED', SYSTEM],
    ['NOTIFY_PRIMARY', 'ACKNOWLEDGED', 'ACKNOWLEDGED', STAFF],
    ['NOTIFY_PRIMARY', 'ACKNOWLEDGED', 'ACKNOWLEDGED', { ...MEMBER, roles: [] }],
    ['UNROUTED', 'REPORTED', 'AUTHORITY_REPORTED', MEMBER],
    ['UNROUTED', 'REPORTED', 'AUTHORITY_REPORTED', { ...STAFF, roles: [] }],
    ['NOTIFY_PRIMARY', 'FALSE_ALARM', 'FALSE_ALARM', STAFF],
    ['UNROUTED', 'FALSE_ALARM', 'FALSE_ALARM', MEMBER],
  ] as [IncidentState, IncidentState, Code, IncidentActor][])(
    'rejects unauthorized actor for %s -> %s',
    async (from, to, code, actor) => {
      current = row(from);
      await expect(apply(to, code, actor, { note: 'Reason' })).rejects.toMatchObject({
        errorCode: ErrorCode.FORBIDDEN,
      });
    },
  );

  it('does not permit a packet to resolve, declare false alarm or route an existing incident', async () => {
    const actor: IncidentActor = { kind: 'DEVICE' };
    current = row('ACKNOWLEDGED', { ownerId: 'owner' });
    await expect(
      apply('RESOLVED', 'RESOLVED', actor, { note: 'Device cancel' }),
    ).rejects.toMatchObject({ errorCode: ErrorCode.FORBIDDEN });
    await expect(
      apply('FALSE_ALARM', 'FALSE_ALARM', actor, { note: 'Device cancel' }),
    ).rejects.toMatchObject({ errorCode: ErrorCode.FORBIDDEN });
    current = row();
    await expect(apply('NOTIFY_PRIMARY', 'ROUTED', actor)).rejects.toMatchObject({
      errorCode: ErrorCode.INVALID_STATE_TRANSITION,
    });
  });

  it.each(['FALSE_ALARM', 'RESOLVED'] as const)('requires a nonblank note for %s', async (to) => {
    current = row('ACKNOWLEDGED', { ownerId: 'owner' });
    await expect(apply(to, to, MEMBER, { note: '  ' })).rejects.toMatchObject({
      errorCode: ErrorCode.VALIDATION_FAILED,
    });
    await expect(apply(to, to, MEMBER)).rejects.toMatchObject({
      errorCode: ErrorCode.VALIDATION_FAILED,
    });
  });

  it.each([
    ['NOTIFY_PRIMARY', 'NOTIFY_BACKUP', 'TIER_TIMEOUT', 'tierDeadlineAt'],
    ['ACKNOWLEDGED', 'ESCALATED', 'STALE_LIMIT', 'statusDueAt'],
    ['RESOLVED', 'CLOSED', 'REOPEN_WINDOW_ENDED', 'reopenWindowEndsAt'],
  ] as [IncidentState, IncidentState, Code, keyof Incident][])(
    'refuses an absent or future deadline for %s',
    async (from, to, code, deadline) => {
      for (const value of [null, AFTER]) {
        current = row(from, { [deadline]: value });
        await expect(apply(to, code)).rejects.toMatchObject({
          errorCode: ErrorCode.INVALID_STATE_TRANSITION,
        });
      }
      current = row(from, { [deadline]: AT });
      await expect(apply(to, code)).resolves.toMatchObject({ state: to });
    },
  );

  it.each(
    (['RESOLVED', 'FALSE_ALARM'] as const).flatMap((from) =>
      [null, BEFORE, AT, AFTER].map((ends) => [from, ends] as const),
    ),
  )('never lets a DEVICE actor close a %s episode (window end %s)', async (from, ends) => {
    // REQ-UBI-05, D-038 rule 2: a person ends every incident; past the window the system closes it.
    current = row(from, { reopenWindowEndsAt: ends });
    await expect(apply('CLOSED', 'REOPEN_WINDOW_ENDED', { kind: 'DEVICE' })).rejects.toMatchObject({
      errorCode: ErrorCode.INVALID_STATE_TRANSITION,
    });
    expect(repository.compareAndSet).not.toHaveBeenCalled();
  });

  it('keeps every other edge closed to a DEVICE actor', async () => {
    current = row('NOTIFY_PRIMARY', { tierDeadlineAt: BEFORE });
    await expect(apply('NOTIFY_BACKUP', 'TIER_TIMEOUT', { kind: 'DEVICE' })).rejects.toMatchObject({
      errorCode: ErrorCode.INVALID_STATE_TRANSITION,
    });
  });

  it('requires an actually empty tier and a deactivated owner for the respective system actions', async () => {
    current = row('NOTIFY_PRIMARY');
    await expect(apply('NOTIFY_BACKUP', 'EMPTY_TIER')).rejects.toMatchObject({
      errorCode: ErrorCode.INVALID_STATE_TRANSITION,
    });
    current = row('ACKNOWLEDGED');
    await expect(apply('NOTIFY_BACKUP', 'OWNER_DEACTIVATED')).rejects.toMatchObject({
      errorCode: ErrorCode.INVALID_STATE_TRANSITION,
    });
  });

  it('uses occurrence time for a queued reopen, replaces attribution and clears the prior response', async () => {
    current = row('RESOLVED', {
      ownerId: 'owner',
      acknowledgedAt: BEFORE,
      resolvedAt: BEFORE,
      outcomeNote: 'Old',
      falseAlarmReason: 'Old',
    });
    const result = await apply(
      'NOTIFY_PRIMARY',
      'REOPENED',
      { kind: 'DEVICE' },
      {
        at: new Date(AFTER.getTime() + 60000),
        occurredAt: AT,
        route: { organizationId: 'org-b', contractId: 'contract-b' },
        refEventId: 'event',
      },
    );
    expect(result).toMatchObject({
      organizationId: 'org-b',
      contractId: 'contract-b',
      ownerId: null,
      acknowledgedAt: null,
      resolvedAt: null,
      outcomeNote: null,
      falseAlarmReason: null,
      reopenCount: 1,
      closedAt: null,
    });
    expect(repository.insertTransition).toHaveBeenCalledWith(
      expect.objectContaining({ refEventId: 'event', actorId: null }),
      tx,
    );
  });

  it.each([
    { occurredAt: AT },
    { route: { organizationId: 'org-a', contractId: 'contract-a' } },
    { at: AFTER, occurredAt: AFTER, route: { organizationId: 'org-a', contractId: 'contract-a' } },
    {
      occurredAt: new Date(BEFORE.getTime() - 1),
      route: { organizationId: 'org-a', contractId: 'contract-a' },
    },
  ])('rejects an incomplete or out-of-window reopen %j', async (options) => {
    current = row('RESOLVED');
    await expect(apply('NOTIFY_PRIMARY', 'REOPENED', SYSTEM, options)).rejects.toMatchObject({
      errorCode: ErrorCode.INVALID_STATE_TRANSITION,
    });
  });

  it.each([
    ['a window never set', null, AT, AT],
    ['an SOS stamped past the window that arrives inside it', AT, AFTER, BEFORE],
  ])('reopens on %s', async (_label, ends, occurredAt, at) => {
    current = row('RESOLVED', { reopenWindowEndsAt: ends });
    await expect(
      apply(
        'NOTIFY_PRIMARY',
        'REOPENED',
        { kind: 'DEVICE' },
        {
          at,
          occurredAt,
          route: { organizationId: 'org-a', contractId: 'contract-a' },
        },
      ),
    ).resolves.toMatchObject({ state: 'NOTIFY_PRIMARY', reopenCount: 1 });
  });

  it('reopens an unattributed SOS to UNROUTED, as a new unattributed incident is routed', async () => {
    current = row('FALSE_ALARM', { ownerId: 'owner', falseAlarmReason: 'Old' });
    const result = await apply(
      'UNROUTED',
      'REOPENED',
      { kind: 'DEVICE' },
      { occurredAt: AT, route: { organizationId: null, contractId: null } },
    );
    expect(result).toMatchObject({
      state: 'UNROUTED',
      organizationId: null,
      contractId: null,
      ownerId: null,
      tierDeadlineAt: null,
      reopenWindowEndsAt: null,
      falseAlarmReason: null,
      reopenCount: 1,
    });
    expect(alerts.enqueue).toHaveBeenCalledWith(
      [
        expect.objectContaining({ tier: 'TREKLINK', recipientId: 'staff' }),
        expect.objectContaining({ recipientId: 'staff' }),
        expect.objectContaining({ recipientId: 'staff' }),
      ],
      tx,
    );
  });

  it('rejects a route without an organization into a tier, or an invalid clock', async () => {
    current = row('RESOLVED');
    await expect(
      apply('NOTIFY_PRIMARY', 'REOPENED', SYSTEM, {
        occurredAt: AT,
        route: { organizationId: null, contractId: null },
      }),
    ).rejects.toMatchObject({ errorCode: ErrorCode.INVALID_STATE_TRANSITION });
    current = row('DETECTED', { organizationId: null });
    await expect(apply('NOTIFY_PRIMARY', 'ROUTED')).rejects.toMatchObject({
      errorCode: ErrorCode.INVALID_STATE_TRANSITION,
    });
    await expect(
      apply('UNROUTED', 'ROUTED', SYSTEM, { at: new Date('invalid') }),
    ).rejects.toMatchObject({ errorCode: ErrorCode.INVALID_STATE_TRANSITION });
  });

  it('does not queue domain events when outbox persistence fails', async () => {
    const error = new Error('outbox write failed');
    alerts.enqueue.mockRejectedValue(error);
    await expect(apply('NOTIFY_PRIMARY', 'ROUTED')).rejects.toBe(error);
    expect(events.emitAfterCommit).not.toHaveBeenCalled();
  });
});
