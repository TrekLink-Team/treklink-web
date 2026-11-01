import { Injectable } from '@nestjs/common';
import { AlertChannel, AlertKind, Incident, IncidentState, Prisma } from '@prisma/client';
import { TransactionalEvents } from '../../platform/events/emit-after-commit';
import { AlertDeliveriesRepository, NewAlertDelivery } from '../alert-deliveries.repository';
import { isTier, tierMembers, tierOf } from '../incident-lifecycle';
import { RoutingService } from '../routing.service';
import { INCIDENT_ALERTS_QUEUED, IncidentAlertsQueuedEvent } from './alert-events';

export interface StaleAlertTargets {
  tier: string;
  recipientIds: readonly string[];
}

// The stale-flag row of design §3 goes to the web inbox and the WebSocket only, never email.
const CHANNELS = [AlertChannel.WEB, AlertChannel.WEBSOCKET] as const;
const TREKLINK_STATES: readonly IncidentState[] = ['ESCALATED', 'UNROUTED', 'REPORTED'];
// An ended incident keeps its flag but alerts nobody, owner or not: a device switched off after a
// rescue is no news, and the banner would keep the alert after the incident ended.
const ENDED_STATES: readonly IncidentState[] = ['RESOLVED', 'FALSE_ALARM'];

// The device-silent alert of REQ-EVT-12 (design §3, MSG40; leader ruling of 2026-11-01). It is queued
// once, in the transaction that sets the incident's stale flag, as STALE outbox rows with no
// transition; clearing the flag queues nothing. Recipients, in order: nobody for a RESOLVED or
// FALSE_ALARM incident; the owner when the incident has one; otherwise the members of its current tier (`NOTIFY_*`), read through routing at `at`;
// otherwise, for ESCALATED, UNROUTED and REPORTED, every active TrekLink Staff and Admin account.
// Any other state (DETECTED, for one) alerts nobody.
@Injectable()
export class StaleAlerts {
  constructor(
    private readonly routing: RoutingService,
    private readonly alerts: AlertDeliveriesRepository,
    private readonly events: TransactionalEvents,
  ) {}

  // Queues the rows inside the caller's transaction and wakes the dispatcher after its commit.
  // Resolves with the number of rows queued.
  async queue(
    incident: Incident,
    lastSeenAt: Date,
    at: Date,
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    const { tier, recipientIds } = await this.targets(incident, at, tx);
    const rows: NewAlertDelivery[] = [];
    for (const recipientId of new Set(recipientIds))
      for (const channel of CHANNELS)
        rows.push({
          incidentId: incident.id,
          kind: AlertKind.STALE,
          transitionId: null,
          lastSeenAt,
          tier,
          recipientId,
          channel,
        });
    await this.alerts.enqueue(rows, tx);
    if (rows.length > 0)
      this.events.emitAfterCommit(INCIDENT_ALERTS_QUEUED, {
        incidentId: incident.id,
      } satisfies IncidentAlertsQueuedEvent);
    return rows.length;
  }

  async targets(
    incident: Pick<Incident, 'state' | 'ownerId' | 'organizationId'>,
    at: Date,
    tx: Prisma.TransactionClient,
  ): Promise<StaleAlertTargets> {
    if (ENDED_STATES.includes(incident.state)) return { tier: 'NONE', recipientIds: [] };
    if (incident.ownerId) return { tier: 'OWNER', recipientIds: [incident.ownerId] };
    if (isTier(incident.state)) {
      const recipients = await this.routing.recipientsOf(incident.organizationId, at, tx);
      return {
        tier: tierOf(incident.state)!,
        recipientIds: tierMembers(incident.state, recipients),
      };
    }
    if (TREKLINK_STATES.includes(incident.state))
      return { tier: 'TREKLINK', recipientIds: await this.routing.treklinkRecipients(tx) };
    return { tier: 'NONE', recipientIds: [] };
  }
}
