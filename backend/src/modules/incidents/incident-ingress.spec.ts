import { Incident, IncidentState, Prisma } from '@prisma/client';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
import { cadenceBurstStart, IncidentIngress, PositionEvent, SosEvent } from './incident-ingress';
import { IncidentLifecycle } from './incident-lifecycle';
import { IncidentsRepository } from './incidents.repository';
import { RoutingService } from './routing.service';

const tx = { tx: true } as unknown as Prisma.TransactionClient;
const RECIPIENTS = { primary: ['p'], backup: [], managers: ['m'], staff: [] };

const event = (overrides: Partial<SosEvent> = {}): SosEvent => ({
  eventId: 'evt-1',
  deviceId: 'dev-1',
  source: 'DEVICE_SOS',
  occurredAt: new Date('2026-10-29T03:00:00Z'),
  organizationId: 'org-a',
  contractId: 'c-a',
  ...overrides,
});

const position = (overrides: Partial<PositionEvent> = {}): PositionEvent => ({
  eventId: 'pos-1',
  deviceId: 'dev-1',
  occurredAt: new Date('2026-10-29T03:01:00Z'),
  latitude: 11.561,
  longitude: 108.552,
  organizationId: 'org-a',
  contractId: 'c-a',
  ...overrides,
});

// Parameter values of the seed (configuration matrix): six positions in 60 s, a 60 s retro-tag grace.
const PARAMETERS: Record<string, number> = {
  'gatewaySync.retroTagGraceSeconds': 60,
  'incidents.cadenceCount': 6,
  'incidents.cadenceWindowSeconds': 60,
};

// `seconds` after 03:00:00Z, the occurrence times the stored-position read answers.
const at = (seconds: number) => new Date(Date.UTC(2026, 9, 29, 3, 0, 0) + seconds * 1000);

const incident = (state: IncidentState, overrides: Partial<Incident> = {}): Incident =>
  ({
    id: 'inc-1',
    deviceId: 'dev-1',
    state,
    version: 3,
    organizationId: 'org-a',
    ownerId: null,
    firstEventAt: new Date('2026-10-29T02:45:00Z'),
    lastEventAt: new Date('2026-10-29T02:50:00Z'),
    stateChangedAt: new Date('2026-10-29T02:55:00Z'),
    reopenWindowEndsAt: null,
    ...overrides,
  }) as Incident;

describe('IncidentIngress.onSos (incidents 2.3, design §4)', () => {
  let repository: {
    lockOpenByDevice: jest.Mock;
    insert: jest.Mock;
    insertTransition: jest.Mock;
    appendEvent: jest.Mock;
    movePosition: jest.Mock;
    lockDeviceCadence: jest.Mock;
    lastClosedAt: jest.Mock;
  };
  let history: { plottedPositionTimes: jest.Mock };
  let lifecycle: { apply: jest.Mock };
  let routing: { route: jest.Mock };
  let events: { emitAfterCommit: jest.Mock };
  let ingress: IncidentIngress;

  beforeEach(() => {
    repository = {
      lockOpenByDevice: jest.fn().mockResolvedValue(null),
      insert: jest
        .fn()
        .mockResolvedValue({ incident: incident('DETECTED', { version: 0 }), created: true }),
      insertTransition: jest.fn().mockResolvedValue({ id: 't-1' }),
      appendEvent: jest.fn().mockImplementation((row: Incident) => Promise.resolve(row)),
      movePosition: jest.fn().mockImplementation((row: Incident) => Promise.resolve(row)),
      lockDeviceCadence: jest.fn().mockResolvedValue(undefined),
      lastClosedAt: jest.fn().mockResolvedValue(null),
    };
    history = { plottedPositionTimes: jest.fn().mockResolvedValue([]) };
    events = { emitAfterCommit: jest.fn() };
    lifecycle = { apply: jest.fn().mockResolvedValue(incident('NOTIFY_PRIMARY')) };
    routing = {
      route: jest.fn().mockResolvedValue({ to: 'NOTIFY_PRIMARY', recipients: RECIPIENTS }),
    };
    ingress = new IncidentIngress(
      repository as unknown as IncidentsRepository,
      lifecycle as unknown as IncidentLifecycle,
      routing as unknown as RoutingService,
      {
        get: jest.fn((key: string) => Promise.resolve(PARAMETERS[key])),
      } as unknown as ParameterService,
      events as unknown as TransactionalEvents,
    );
  });

  it('creates a CONFIRMED incident in DETECTED, writes transition 1, then routes it (AC-01)', async () => {
    await expect(ingress.onSos(event(), tx)).resolves.toMatchObject({ state: 'NOTIFY_PRIMARY' });
    expect(repository.lockOpenByDevice).toHaveBeenCalledWith('dev-1', tx);
    expect(repository.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: 'dev-1',
        source: 'DEVICE_SOS',
        confidence: 'CONFIRMED',
        openedByEventId: 'evt-1',
        organizationId: 'org-a',
        contractId: 'c-a',
      }),
      expect.any(Date),
      tx,
    );
    expect(repository.insertTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        incidentId: 'inc-1',
        fromState: null,
        toState: 'DETECTED',
        reason: 'CREATED',
        refEventId: 'evt-1',
      }),
      tx,
    );
    const [id, expected, to, actor, reason] = lifecycle.apply.mock.calls[0] as Parameters<
      IncidentLifecycle['apply']
    >;
    expect([id, expected, to, actor]).toEqual([
      'inc-1',
      'DETECTED',
      'NOTIFY_PRIMARY',
      { kind: 'SYSTEM' },
    ]);
    expect(reason).toMatchObject({ code: 'ROUTED', recipients: RECIPIENTS, refEventId: 'evt-1' });
  });

  it('routes an unattributed SOS to UNROUTED', async () => {
    routing.route.mockResolvedValue({ to: 'UNROUTED', recipients: RECIPIENTS });
    await ingress.onSos(event({ organizationId: null, contractId: null }), tx);
    expect(repository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: null, contractId: null }),
      expect.any(Date),
      tx,
    );
    expect((lifecycle.apply.mock.calls[0] as unknown[])[2]).toBe('UNROUTED');
  });

  it('joins the winner when a concurrent SOS of the device created the incident first', async () => {
    const winner = incident('NOTIFY_PRIMARY');
    repository.insert.mockResolvedValue({ incident: winner, created: false });
    await expect(ingress.onSos(event(), tx)).resolves.toBe(winner);
    expect(repository.appendEvent).toHaveBeenCalledWith(winner, event().occurredAt, tx);
    expect(repository.insertTransition).not.toHaveBeenCalled();
    expect(lifecycle.apply).not.toHaveBeenCalled();
  });

  it.each<IncidentState>(['NOTIFY_PRIMARY', 'ACKNOWLEDGED', 'RESPONDING', 'ESCALATED'])(
    'appends to an open %s episode without a transition (steps 4 and 5)',
    async (state) => {
      const open = incident(state);
      repository.lockOpenByDevice.mockResolvedValue(open);
      await ingress.onSos(event(), tx);
      expect(repository.appendEvent).toHaveBeenCalledWith(open, event().occurredAt, tx);
      expect(repository.insert).not.toHaveBeenCalled();
      expect(lifecycle.apply).not.toHaveBeenCalled();
    },
  );

  // The server clock of `onSos`: inside the 03:55 window unless a test moves it.
  const serverNow = (iso: string) =>
    jest.useFakeTimers({
      now: new Date(iso),
      doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'setTimeout', 'setInterval'],
    });
  const WINDOW_END = new Date('2026-10-29T03:55:00Z');
  const calls = () => lifecycle.apply.mock.calls as Parameters<IncidentLifecycle['apply']>[];

  beforeEach(() => serverNow('2026-10-29T03:30:00Z'));
  afterEach(() => {
    jest.useRealTimers();
    // A packet never ends an incident (REQ-UBI-05, D-038 rule 2).
    expect(calls().filter(([, , to, actor]) => to === 'CLOSED' && actor.kind === 'DEVICE')).toEqual(
      [],
    );
  });

  it('reopens a RESOLVED episode inside its window, re-routed (step 3)', async () => {
    const resolved = incident('RESOLVED', { reopenWindowEndsAt: WINDOW_END });
    repository.lockOpenByDevice.mockResolvedValue(resolved);
    await ingress.onSos(event(), tx);
    expect(repository.appendEvent).toHaveBeenCalled();
    const [, expected, to, actor, reason] = calls()[0];
    expect([expected, to, actor]).toEqual(['RESOLVED', 'NOTIFY_PRIMARY', { kind: 'DEVICE' }]);
    expect(reason).toMatchObject({
      code: 'REOPENED',
      refEventId: 'evt-1',
      route: { organizationId: 'org-a', contractId: 'c-a' },
      recipients: RECIPIENTS,
    });
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it('reopens an unattributed SOS inside the window to UNROUTED, routed as at creation', async () => {
    const unrouted = { to: 'UNROUTED', recipients: { ...RECIPIENTS, primary: [] } };
    routing.route.mockResolvedValue(unrouted);
    const ended = incident('FALSE_ALARM', { reopenWindowEndsAt: WINDOW_END });
    repository.lockOpenByDevice.mockResolvedValue(ended);
    const sos = event({ organizationId: null, contractId: null });
    await ingress.onSos(sos, tx);
    expect(routing.route).toHaveBeenCalledWith(sos, expect.any(Date), tx);
    expect(calls()).toHaveLength(1);
    const [id, expected, to, actor, reason] = calls()[0];
    expect([id, expected, to, actor]).toEqual([
      'inc-1',
      'FALSE_ALARM',
      'UNROUTED',
      { kind: 'DEVICE' },
    ]);
    expect(reason).toMatchObject({
      code: 'REOPENED',
      recipients: unrouted.recipients,
      route: { organizationId: null, contractId: null },
      occurredAt: sos.occurredAt,
    });
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it('reopens, never closes, an episode whose window was never set', async () => {
    serverNow('2026-10-30T03:00:00Z');
    repository.lockOpenByDevice.mockResolvedValue(incident('RESOLVED'));
    await ingress.onSos(event({ occurredAt: new Date('2026-10-30T02:59:00Z') }), tx);
    expect(calls()).toHaveLength(1);
    expect(calls()[0].slice(2, 4)).toEqual(['NOTIFY_PRIMARY', { kind: 'DEVICE' }]);
    expect(calls()[0][4].code).toBe('REOPENED');
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it.each([
    ['that occurred inside the window but was uploaded after it', '2026-10-29T04:30:00Z', '03:00'],
    ['stamped past the window by a device clock running ahead', '2026-10-29T03:54:00Z', '03:56'],
  ])('reopens an SOS %s', async (_label, now, time) => {
    serverNow(now);
    repository.lockOpenByDevice.mockResolvedValue(
      incident('RESOLVED', { reopenWindowEndsAt: WINDOW_END }),
    );
    await ingress.onSos(event({ occurredAt: new Date(`2026-10-29T${time}:00Z`) }), tx);
    expect(calls()).toHaveLength(1);
    expect(calls()[0][4].code).toBe('REOPENED');
  });

  it.each([
    ['attributed', {}, 'NOTIFY_PRIMARY'],
    ['unattributed', { organizationId: null, contractId: null }, 'UNROUTED'],
  ] as const)(
    'past the window, closes the ended episode as SYSTEM and opens a new incident (%s SOS)',
    async (_label, overrides, routedTo) => {
      serverNow('2026-10-29T04:30:00Z');
      routing.route.mockResolvedValue({ to: routedTo, recipients: RECIPIENTS });
      repository.lockOpenByDevice.mockResolvedValue(
        incident('FALSE_ALARM', { reopenWindowEndsAt: WINDOW_END }),
      );
      await ingress.onSos(
        event({ occurredAt: new Date('2026-10-29T04:00:00Z'), ...overrides }),
        tx,
      );
      const [id, expected, to, actor, reason] = calls()[0];
      expect([id, expected, to, actor]).toEqual([
        'inc-1',
        'FALSE_ALARM',
        'CLOSED',
        { kind: 'SYSTEM' },
      ]);
      expect(reason).toMatchObject({
        code: 'REOPEN_WINDOW_ENDED',
        at: new Date('2026-10-29T04:30:00Z'),
        refEventId: 'evt-1',
      });
      expect(repository.insert).toHaveBeenCalledWith(
        expect.objectContaining({ openedByEventId: 'evt-1', ...overrides }),
        expect.any(Date),
        tx,
      );
      expect(calls()[1].slice(2, 4)).toEqual([routedTo, { kind: 'SYSTEM' }]);
      expect(calls()[1][4].code).toBe('ROUTED');
      expect(repository.appendEvent).not.toHaveBeenCalled();
    },
  );

  it('records a late SOS that occurred before the episode ended on that episode', async () => {
    const resolved = incident('RESOLVED', { reopenWindowEndsAt: new Date('2026-10-29T03:55:00Z') });
    repository.lockOpenByDevice.mockResolvedValue(resolved);
    await ingress.onSos(event({ occurredAt: new Date('2026-10-29T02:54:00Z') }), tx);
    expect(repository.appendEvent).toHaveBeenCalledWith(
      resolved,
      new Date('2026-10-29T02:54:00Z'),
      tx,
    );
    expect(lifecycle.apply).not.toHaveBeenCalled();
    expect(repository.insert).not.toHaveBeenCalled();
  });

  describe('onPosition', () => {
    it('joins a running episode, moves its last position and announces it after commit', async () => {
      const open = incident('ACKNOWLEDGED', { ownerId: 'u-1' });
      repository.lockOpenByDevice.mockResolvedValue(open);
      await expect(ingress.onPosition(position(), tx, history)).resolves.toBe(open);
      expect(repository.movePosition).toHaveBeenCalledWith(open, position(), tx);
      expect(events.emitAfterCommit).toHaveBeenCalledWith('incident.changed', {
        incidentId: 'inc-1',
        deviceId: 'dev-1',
        organizationId: 'org-a',
        state: 'ACKNOWLEDGED',
        tier: null,
        ownerId: 'u-1',
      });
    });

    it('tags a position up to the grace before the first SOS into the episode', async () => {
      repository.lockOpenByDevice.mockResolvedValue(incident('NOTIFY_PRIMARY'));
      await ingress.onPosition(
        position({ occurredAt: new Date('2026-10-29T02:44:00Z') }),
        tx,
        history,
      );
      expect(repository.movePosition).toHaveBeenCalled();
    });

    it('joins without announcing when an older position does not move the last one', async () => {
      const open = incident('RESPONDING');
      repository.lockOpenByDevice.mockResolvedValue(open);
      repository.movePosition.mockResolvedValue(null);
      await expect(ingress.onPosition(position(), tx, history)).resolves.toBe(open);
      expect(events.emitAfterCommit).not.toHaveBeenCalled();
    });

    it.each([
      ['a RESOLVED episode', incident('RESOLVED')],
      ['a FALSE_ALARM episode', incident('FALSE_ALARM')],
    ])('ignores a position with %s and counts no cadence', async (_label, open) => {
      repository.lockOpenByDevice.mockResolvedValue(open);
      await expect(ingress.onPosition(position(), tx, history)).resolves.toBeNull();
      expect(repository.movePosition).not.toHaveBeenCalled();
      expect(history.plottedPositionTimes).not.toHaveBeenCalled();
      expect(repository.insert).not.toHaveBeenCalled();
    });

    it('ignores a position with no open incident and no burst', async () => {
      history.plottedPositionTimes.mockResolvedValue([at(60)]);
      await expect(
        ingress.onPosition(position({ occurredAt: at(60) }), tx, history),
      ).resolves.toBeNull();
      expect(repository.movePosition).not.toHaveBeenCalled();
      expect(repository.insert).not.toHaveBeenCalled();
    });

    it('ignores a position older than the grace before the first SOS', async () => {
      repository.lockOpenByDevice.mockResolvedValue(incident('NOTIFY_PRIMARY'));
      await expect(
        ingress.onPosition(position({ occurredAt: new Date('2026-10-29T02:43:59Z') }), tx, history),
      ).resolves.toBeNull();
      expect(repository.movePosition).not.toHaveBeenCalled();
    });

    describe('cadence (REQ-EVT-02)', () => {
      // Six positions 12 s apart: 0, 12, 24, 36, 48, 60 s, the last one being handed over.
      const burst = [0, 12, 24, 36, 48, 60].map(at);
      const onPosition = (event = position({ eventId: 'pos-6', occurredAt: at(60) })) =>
        ingress.onPosition(event, tx, history);

      it('opens one SUSPECTED incident from CADENCE_INFERRED and routes it as at creation', async () => {
        history.plottedPositionTimes.mockResolvedValue(burst);
        await expect(onPosition()).resolves.toMatchObject({ state: 'NOTIFY_PRIMARY' });
        expect(repository.lockDeviceCadence).toHaveBeenCalledWith('dev-1', tx);
        expect(repository.lockOpenByDevice).toHaveBeenCalledTimes(2);
        expect(history.plottedPositionTimes).toHaveBeenCalledWith('dev-1', at(0), at(120), tx);
        expect(repository.insert).toHaveBeenCalledWith(
          {
            deviceId: 'dev-1',
            source: 'CADENCE_INFERRED',
            confidence: 'SUSPECTED',
            firstEventAt: at(0),
            lastEventAt: at(60),
            openedByEventId: 'pos-6',
            contractId: 'c-a',
            organizationId: 'org-a',
            lastLatitude: 11.561,
            lastLongitude: 108.552,
            lastPositionAt: at(60),
          },
          expect.any(Date),
          tx,
        );
        expect(repository.insertTransition).toHaveBeenCalledWith(
          expect.objectContaining({
            incidentId: 'inc-1',
            fromState: null,
            toState: 'DETECTED',
            reason: 'CREATED',
            refEventId: 'pos-6',
          }),
          tx,
        );
        expect(routing.route).toHaveBeenCalledWith(
          expect.objectContaining({ organizationId: 'org-a', contractId: 'c-a' }),
          expect.any(Date),
          tx,
        );
        const [id, expected, to, actor, reason] = lifecycle.apply.mock.calls[0] as Parameters<
          IncidentLifecycle['apply']
        >;
        expect([id, expected, to, actor]).toEqual([
          'inc-1',
          'DETECTED',
          'NOTIFY_PRIMARY',
          { kind: 'SYSTEM' },
        ]);
        expect(reason).toMatchObject({
          code: 'ROUTED',
          recipients: RECIPIENTS,
          refEventId: 'pos-6',
        });
        expect(repository.movePosition).not.toHaveBeenCalled();
      });

      it('routes an unattributed burst to UNROUTED', async () => {
        history.plottedPositionTimes.mockResolvedValue(burst);
        routing.route.mockResolvedValue({ to: 'UNROUTED', recipients: RECIPIENTS });
        await onPosition(position({ occurredAt: at(60), organizationId: null, contractId: null }));
        expect(repository.insert).toHaveBeenCalledWith(
          expect.objectContaining({ organizationId: null, contractId: null }),
          expect.any(Date),
          tx,
        );
        expect((lifecycle.apply.mock.calls[0] as Parameters<IncidentLifecycle['apply']>)[2]).toBe(
          'UNROUTED',
        );
      });

      it('opens nothing one position short of the count', async () => {
        history.plottedPositionTimes.mockResolvedValue(burst.slice(1));
        await expect(onPosition()).resolves.toBeNull();
        expect(repository.insert).not.toHaveBeenCalled();
        expect(lifecycle.apply).not.toHaveBeenCalled();
      });

      it('counts no position of an incident that has since closed, so a burst opens one incident', async () => {
        history.plottedPositionTimes.mockResolvedValue(burst);
        repository.lastClosedAt.mockResolvedValue(at(0));
        await expect(onPosition()).resolves.toBeNull();
        expect(repository.lastClosedAt).toHaveBeenCalledWith('dev-1', tx);
        expect(repository.insert).not.toHaveBeenCalled();
      });

      it('counts the positions after the last close', async () => {
        history.plottedPositionTimes.mockResolvedValue([...burst, at(61)]);
        repository.lastClosedAt.mockResolvedValue(at(0));
        await onPosition(position({ eventId: 'pos-7', occurredAt: at(61) }));
        expect(repository.insert).toHaveBeenCalledWith(
          expect.objectContaining({ firstEventAt: at(12), openedByEventId: 'pos-7' }),
          expect.any(Date),
          tx,
        );
      });

      it('counts nothing while an incident is open: the position joins it instead', async () => {
        const open = incident('NOTIFY_PRIMARY', {
          source: 'CADENCE_INFERRED',
          confidence: 'SUSPECTED',
          firstEventAt: at(0),
        });
        repository.lockOpenByDevice.mockResolvedValue(open);
        history.plottedPositionTimes.mockResolvedValue([...burst, at(66)]);
        await expect(onPosition(position({ occurredAt: at(66) }))).resolves.toBe(open);
        expect(repository.lockDeviceCadence).not.toHaveBeenCalled();
        expect(history.plottedPositionTimes).not.toHaveBeenCalled();
        expect(repository.insert).not.toHaveBeenCalled();
        expect(repository.movePosition).toHaveBeenCalled();
      });

      it('joins the incident a concurrent burst opened while this one waited for the lock', async () => {
        const opened = incident('NOTIFY_PRIMARY', { firstEventAt: at(0) });
        repository.lockOpenByDevice.mockResolvedValueOnce(null).mockResolvedValueOnce(opened);
        await expect(onPosition()).resolves.toBe(opened);
        expect(history.plottedPositionTimes).not.toHaveBeenCalled();
        expect(repository.insert).not.toHaveBeenCalled();
        expect(repository.movePosition).toHaveBeenCalledWith(
          opened,
          expect.objectContaining({ occurredAt: at(60) }),
          tx,
        );
      });

      it('joins the incident a concurrent SOS inserted first, writing no transition', async () => {
        history.plottedPositionTimes.mockResolvedValue(burst);
        const winner = incident('NOTIFY_PRIMARY', { firstEventAt: at(30) });
        repository.insert.mockResolvedValue({ incident: winner, created: false });
        await expect(onPosition()).resolves.toBe(winner);
        expect(repository.insertTransition).not.toHaveBeenCalled();
        expect(lifecycle.apply).not.toHaveBeenCalled();
        expect(repository.movePosition).toHaveBeenCalledWith(
          winner,
          expect.objectContaining({ occurredAt: at(60) }),
          tx,
        );
      });
    });
  });

  describe('SUSPECTED upgrade (REQ-EVT-02)', () => {
    it('upgrades a SUSPECTED incident in place on a later SOS and announces it after commit', async () => {
      const suspected = incident('NOTIFY_PRIMARY', {
        source: 'CADENCE_INFERRED',
        confidence: 'SUSPECTED',
      });
      repository.lockOpenByDevice.mockResolvedValue(suspected);
      repository.appendEvent.mockResolvedValue({ ...suspected, confidence: 'CONFIRMED' });
      await expect(ingress.onSos(event(), tx)).resolves.toMatchObject({
        id: 'inc-1',
        confidence: 'CONFIRMED',
      });
      expect(repository.appendEvent).toHaveBeenCalledWith(
        suspected,
        new Date('2026-10-29T03:00:00Z'),
        tx,
      );
      expect(repository.insert).not.toHaveBeenCalled();
      expect(lifecycle.apply).not.toHaveBeenCalled();
      expect(events.emitAfterCommit).toHaveBeenCalledWith('incident.changed', {
        incidentId: 'inc-1',
        deviceId: 'dev-1',
        organizationId: 'org-a',
        state: 'NOTIFY_PRIMARY',
        tier: 'PRIMARY',
        ownerId: null,
      });
    });

    it('announces nothing when an SOS joins a CONFIRMED episode (MF-03 unchanged)', async () => {
      repository.lockOpenByDevice.mockResolvedValue(
        incident('NOTIFY_PRIMARY', { confidence: 'CONFIRMED' }),
      );
      await ingress.onSos(event(), tx);
      expect(repository.appendEvent).toHaveBeenCalled();
      expect(events.emitAfterCommit).not.toHaveBeenCalled();
    });
  });
});

describe('cadenceBurstStart (REQ-EVT-02 window edges)', () => {
  const WINDOW = 60_000;
  const times = (...seconds: number[]) => seconds.map(at);

  it('counts both window edges: six positions exactly 60 s apart end to end', () => {
    expect(cadenceBurstStart(times(0, 12, 24, 36, 48, 60), at(60), WINDOW, 6)).toEqual(at(0));
  });

  it('does not count a position 1 ms outside the window', () => {
    const spread = [at(0), ...times(12, 24, 36, 48), new Date(at(60).getTime() + 1)];
    expect(cadenceBurstStart(spread, spread[5], WINDOW, 6)).toBeNull();
  });

  it('needs the full count', () => {
    expect(cadenceBurstStart(times(0, 10, 20, 30, 40), at(40), WINDOW, 6)).toBeNull();
    expect(cadenceBurstStart(times(0, 10, 20, 30, 40, 50), at(50), WINDOW, 6)).toEqual(at(0));
  });

  it('ignores a burst whose window cannot contain the position being handed over', () => {
    expect(cadenceBurstStart(times(0, 5, 10, 15, 20, 25, 90), at(90), WINDOW, 6)).toBeNull();
  });

  it('finds a burst completed by a late position that occurred first (out of order)', () => {
    expect(cadenceBurstStart(times(0, 10, 20, 30, 40, 50), at(0), WINDOW, 6)).toEqual(at(0));
  });

  it('returns the earliest start of a qualifying window', () => {
    expect(cadenceBurstStart(times(0, 30, 40, 50, 60, 70, 80), at(70), WINDOW, 6)).toEqual(at(30));
    expect(cadenceBurstStart(times(10, 20, 30, 40, 50, 60, 70), at(70), WINDOW, 6)).toEqual(at(10));
  });

  it('never counts a position after the handed-over one beyond the window', () => {
    expect(cadenceBurstStart(times(0, 61, 62, 63, 64, 65), at(0), WINDOW, 6)).toBeNull();
  });

  it('answers null for no positions', () => {
    expect(cadenceBurstStart([], at(0), WINDOW, 2)).toBeNull();
  });
});
