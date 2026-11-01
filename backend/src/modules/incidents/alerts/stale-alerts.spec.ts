import { AlertChannel, AlertKind, Incident, IncidentState, Prisma } from '@prisma/client';
import type { TransactionalEvents } from '../../platform/events/emit-after-commit';
import type { AlertDeliveriesRepository } from '../alert-deliveries.repository';
import type { RoutingService } from '../routing.service';
import { INCIDENT_ALERTS_QUEUED } from './alert-events';
import { StaleAlerts } from './stale-alerts';

const tx = { tx: true } as unknown as Prisma.TransactionClient;
const AT = new Date('2026-11-01T03:00:00.000Z');
const LAST_SEEN = new Date('2026-11-01T02:54:00.000Z');

const incident = (state: IncidentState, overrides: Partial<Incident> = {}): Incident =>
  ({
    id: 'incident',
    deviceId: 'device',
    organizationId: 'org-a',
    state,
    ownerId: null,
    ...overrides,
  }) as Incident;

describe('StaleAlerts (REQ-EVT-12, MSG40)', () => {
  let routing: { recipientsOf: jest.Mock; treklinkRecipients: jest.Mock };
  let alerts: { enqueue: jest.Mock };
  let events: { emitAfterCommit: jest.Mock };
  let service: StaleAlerts;

  beforeEach(() => {
    routing = {
      recipientsOf: jest.fn().mockResolvedValue({
        primary: ['u-primary'],
        backup: ['u-backup'],
        managers: ['u-manager-1', 'u-manager-2'],
        staff: ['u-staff'],
      }),
      treklinkRecipients: jest.fn().mockResolvedValue(['u-staff', 'u-admin']),
    };
    alerts = { enqueue: jest.fn().mockResolvedValue(undefined) };
    events = { emitAfterCommit: jest.fn() };
    service = new StaleAlerts(
      routing as unknown as RoutingService,
      alerts as unknown as AlertDeliveriesRepository,
      events as unknown as TransactionalEvents,
    );
  });

  const targets = (state: IncidentState, overrides: Partial<Incident> = {}) =>
    service.targets(incident(state, overrides), AT, tx);

  describe('recipients', () => {
    it.each<IncidentState>(['ACKNOWLEDGED', 'RESPONDING', 'ESCALATED'])(
      'alerts the owner alone when %s has one',
      async (state) => {
        await expect(targets(state, { ownerId: 'u-owner' })).resolves.toEqual({
          tier: 'OWNER',
          recipientIds: ['u-owner'],
        });
        expect(routing.recipientsOf).not.toHaveBeenCalled();
        expect(routing.treklinkRecipients).not.toHaveBeenCalled();
      },
    );

    it.each<[IncidentState, string, string[]]>([
      ['NOTIFY_PRIMARY', 'PRIMARY', ['u-primary']],
      ['NOTIFY_BACKUP', 'BACKUP', ['u-backup']],
      ['NOTIFY_MANAGER', 'MANAGER', ['u-manager-1', 'u-manager-2']],
    ])(
      'alerts the members of the current tier for %s, read through routing',
      async (state, tier, ids) => {
        await expect(targets(state)).resolves.toEqual({ tier, recipientIds: ids });
        expect(routing.recipientsOf).toHaveBeenCalledWith('org-a', AT, tx);
      },
    );

    it.each<IncidentState>(['ESCALATED', 'UNROUTED', 'REPORTED'])(
      'alerts every active TrekLink Staff and Admin account for %s without an owner',
      async (state) => {
        await expect(targets(state, { organizationId: null })).resolves.toEqual({
          tier: 'TREKLINK',
          recipientIds: ['u-staff', 'u-admin'],
        });
        expect(routing.treklinkRecipients).toHaveBeenCalledWith(tx);
        expect(routing.recipientsOf).not.toHaveBeenCalled();
      },
    );

    it.each<IncidentState>(['FALSE_ALARM', 'RESOLVED', 'DETECTED'])(
      'alerts nobody for %s without an owner',
      async (state) => {
        await expect(targets(state)).resolves.toEqual({ tier: 'NONE', recipientIds: [] });
      },
    );

    // A RESOLVED incident always has an owner, and a FALSE_ALARM declared from ACKNOWLEDGED or
    // RESPONDING keeps one; the device going silent after it ended is no alert.
    it.each<IncidentState>(['RESOLVED', 'FALSE_ALARM'])(
      'alerts nobody for %s even with an owner',
      async (state) => {
        await expect(targets(state, { ownerId: 'u-owner' })).resolves.toEqual({
          tier: 'NONE',
          recipientIds: [],
        });
        expect(routing.recipientsOf).not.toHaveBeenCalled();
        expect(routing.treklinkRecipients).not.toHaveBeenCalled();
      },
    );

    it('queues nothing for a RESOLVED incident with an owner', async () => {
      await expect(
        service.queue(incident('RESOLVED', { ownerId: 'u-owner' }), LAST_SEEN, AT, tx),
      ).resolves.toBe(0);
      expect(events.emitAfterCommit).not.toHaveBeenCalled();
    });
  });

  describe('queue', () => {
    it('writes one STALE row per recipient on WEB and WEBSOCKET, with no transition and the reading', async () => {
      await expect(service.queue(incident('NOTIFY_PRIMARY'), LAST_SEEN, AT, tx)).resolves.toBe(2);
      expect(alerts.enqueue).toHaveBeenCalledWith(
        [AlertChannel.WEB, AlertChannel.WEBSOCKET].map((channel) => ({
          incidentId: 'incident',
          kind: AlertKind.STALE,
          transitionId: null,
          lastSeenAt: LAST_SEEN,
          tier: 'PRIMARY',
          recipientId: 'u-primary',
          channel,
        })),
        tx,
      );
    });

    it('never queues an email or an API event', async () => {
      await service.queue(incident('ESCALATED'), LAST_SEEN, AT, tx);
      const [rows] = alerts.enqueue.mock.calls[0] as [{ channel: AlertChannel }[]];
      expect(rows).toHaveLength(4);
      expect(new Set(rows.map((row) => row.channel))).toEqual(
        new Set([AlertChannel.WEB, AlertChannel.WEBSOCKET]),
      );
    });

    it('alerts an account listed twice once', async () => {
      routing.treklinkRecipients.mockResolvedValue(['u-staff', 'u-staff']);
      await expect(service.queue(incident('UNROUTED'), LAST_SEEN, AT, tx)).resolves.toBe(2);
    });

    it('wakes the dispatcher after the commit when it queued rows', async () => {
      await service.queue(incident('ACKNOWLEDGED', { ownerId: 'u-owner' }), LAST_SEEN, AT, tx);
      expect(events.emitAfterCommit).toHaveBeenCalledWith(INCIDENT_ALERTS_QUEUED, {
        incidentId: 'incident',
      });
    });

    it('queues nothing and wakes nobody when there is no recipient', async () => {
      routing.recipientsOf.mockResolvedValue({ primary: [], backup: [], managers: [], staff: [] });
      await expect(service.queue(incident('NOTIFY_PRIMARY'), LAST_SEEN, AT, tx)).resolves.toBe(0);
      expect(alerts.enqueue).toHaveBeenCalledWith([], tx);
      expect(events.emitAfterCommit).not.toHaveBeenCalled();
    });
  });
});
