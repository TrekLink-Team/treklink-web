import { Incident, IncidentState, Prisma } from '@prisma/client';
import { IncidentIngress, SosEvent } from './incident-ingress';
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
  latitude: 21.03,
  longitude: 105.85,
  ...overrides,
});

const incident = (state: IncidentState, overrides: Partial<Incident> = {}): Incident =>
  ({
    id: 'inc-1',
    state,
    version: 3,
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
  };
  let lifecycle: { apply: jest.Mock };
  let routing: { route: jest.Mock };
  let ingress: IncidentIngress;

  beforeEach(() => {
    repository = {
      lockOpenByDevice: jest.fn().mockResolvedValue(null),
      insert: jest
        .fn()
        .mockResolvedValue({ incident: incident('DETECTED', { version: 0 }), created: true }),
      insertTransition: jest.fn().mockResolvedValue({ id: 't-1' }),
      appendEvent: jest.fn().mockImplementation((row: Incident) => Promise.resolve(row)),
    };
    lifecycle = { apply: jest.fn().mockResolvedValue(incident('NOTIFY_PRIMARY')) };
    routing = {
      route: jest.fn().mockResolvedValue({ to: 'NOTIFY_PRIMARY', recipients: RECIPIENTS }),
    };
    ingress = new IncidentIngress(
      repository as unknown as IncidentsRepository,
      lifecycle as unknown as IncidentLifecycle,
      routing as unknown as RoutingService,
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
        lastLatitude: 21.03,
        lastLongitude: 105.85,
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

  it('routes an unattributed SOS to UNROUTED with no position when none was plotted', async () => {
    routing.route.mockResolvedValue({ to: 'UNROUTED', recipients: RECIPIENTS });
    await ingress.onSos(
      event({ organizationId: null, contractId: null, latitude: undefined, longitude: undefined }),
      tx,
    );
    expect(repository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ lastLatitude: null, lastLongitude: null, organizationId: null }),
      expect.any(Date),
      tx,
    );
    expect((lifecycle.apply.mock.calls[0] as unknown[])[2]).toBe('UNROUTED');
  });

  it('joins the winner when a concurrent SOS of the device created the incident first', async () => {
    const winner = incident('NOTIFY_PRIMARY');
    repository.insert.mockResolvedValue({ incident: winner, created: false });
    await expect(ingress.onSos(event(), tx)).resolves.toBe(winner);
    expect(repository.appendEvent).toHaveBeenCalledWith(winner, expect.any(Object), tx);
    expect(repository.insertTransition).not.toHaveBeenCalled();
    expect(lifecycle.apply).not.toHaveBeenCalled();
  });

  it.each<IncidentState>(['NOTIFY_PRIMARY', 'ACKNOWLEDGED', 'RESPONDING', 'ESCALATED'])(
    'appends to an open %s episode without a transition (steps 4 and 5)',
    async (state) => {
      const open = incident(state);
      repository.lockOpenByDevice.mockResolvedValue(open);
      await ingress.onSos(event(), tx);
      expect(repository.appendEvent).toHaveBeenCalledWith(open, expect.any(Object), tx);
      expect(repository.insert).not.toHaveBeenCalled();
      expect(lifecycle.apply).not.toHaveBeenCalled();
    },
  );

  it('reopens a RESOLVED episode inside its window, re-routed (step 3)', async () => {
    const resolved = incident('RESOLVED', {
      reopenWindowEndsAt: new Date('2026-10-29T03:55:00Z'),
    });
    repository.lockOpenByDevice.mockResolvedValue(resolved);
    await ingress.onSos(event(), tx);
    expect(repository.appendEvent).toHaveBeenCalled();
    const [, expected, to, actor, reason] = lifecycle.apply.mock.calls[0] as Parameters<
      IncidentLifecycle['apply']
    >;
    expect([expected, to, actor]).toEqual(['RESOLVED', 'NOTIFY_PRIMARY', { kind: 'DEVICE' }]);
    expect(reason).toMatchObject({
      code: 'REOPENED',
      refEventId: 'evt-1',
      route: { organizationId: 'org-a', contractId: 'c-a' },
      recipients: RECIPIENTS,
    });
  });

  it.each([
    ['after the window', { occurredAt: new Date('2026-10-29T04:00:00Z') }],
    ['before the resolution', { occurredAt: new Date('2026-10-29T02:54:00Z') }],
    ['unattributed', { organizationId: null, contractId: null }],
  ])('appends instead of reopening when the SOS is %s', async (_label, overrides) => {
    repository.lockOpenByDevice.mockResolvedValue(
      incident('FALSE_ALARM', { reopenWindowEndsAt: new Date('2026-10-29T03:55:00Z') }),
    );
    await ingress.onSos(event(overrides), tx);
    expect(repository.appendEvent).toHaveBeenCalled();
    expect(lifecycle.apply).not.toHaveBeenCalled();
  });

  it('appends to a RESOLVED episode whose window was never set', async () => {
    repository.lockOpenByDevice.mockResolvedValue(incident('RESOLVED'));
    await ingress.onSos(event(), tx);
    expect(lifecycle.apply).not.toHaveBeenCalled();
  });
});
