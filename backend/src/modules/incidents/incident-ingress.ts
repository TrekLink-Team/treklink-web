import { Injectable } from '@nestjs/common';
import { Incident, IncidentSource, Prisma } from '@prisma/client';
import { IncidentLifecycle } from './incident-lifecycle';
import { IncidentsRepository } from './incidents.repository';
import { Attribution, RoutingService } from './routing.service';

// An SOS as gateway-sync stores it: the field event, its attribution at the occurrence time (D-040)
// and its position, when the packet carried a valid one.
export interface SosEvent extends Attribution {
  eventId: string;
  deviceId: string;
  source: Extract<IncidentSource, 'DEVICE_SOS' | 'DEVICE_FALL'>;
  occurredAt: Date;
  latitude?: number;
  longitude?: number;
}

const REOPENABLE = new Set(['RESOLVED', 'FALSE_ALARM']);

// Task 2.3, the SOS half (design §4). gateway-sync calls `onSos` inside the ingestion transaction, so
// the incident, its history, the outbox rows and the field event commit together. A replayed packet
// never reaches here: ingestion rejects it as a duplicate first (REQ-ERR-03).
@Injectable()
export class IncidentIngress {
  constructor(
    private readonly repository: IncidentsRepository,
    private readonly lifecycle: IncidentLifecycle,
    private readonly routing: RoutingService,
  ) {}

  // Returns the incident the event opened or joined; the caller links its field event to it.
  async onSos(event: SosEvent, tx: Prisma.TransactionClient): Promise<Incident> {
    const at = new Date();
    // Step 1: the device's incident outside CLOSED, locked.
    const open = await this.repository.lockOpenByDevice(event.deviceId, tx);
    if (!open) return this.open(event, at, tx);
    // Step 3: inside the reopen window, a resolved or false-alarm episode reopens, re-routed.
    if (
      REOPENABLE.has(open.state) &&
      event.organizationId &&
      open.reopenWindowEndsAt &&
      event.occurredAt >= open.stateChangedAt &&
      event.occurredAt < open.reopenWindowEndsAt
    ) {
      await this.repository.appendEvent(open, event, tx);
      const { recipients } = await this.routing.route(event, at, tx);
      return this.lifecycle.apply(
        open.id,
        open.state,
        'NOTIFY_PRIMARY',
        { kind: 'DEVICE' },
        {
          code: 'REOPENED',
          at,
          recipients,
          refEventId: event.eventId,
          occurredAt: event.occurredAt,
          route: { organizationId: event.organizationId, contractId: event.contractId },
        },
        tx,
      );
    }
    // Steps 4 and 5: any other open episode is the same emergency still running.
    return this.repository.appendEvent(open, event, tx);
  }

  // Step 2: create in DETECTED with transition 1, then route as transition 2.
  private async open(event: SosEvent, at: Date, tx: Prisma.TransactionClient): Promise<Incident> {
    const { incident, created } = await this.repository.insert(
      {
        deviceId: event.deviceId,
        source: event.source,
        confidence: 'CONFIRMED',
        firstEventAt: event.occurredAt,
        lastEventAt: event.occurredAt,
        openedByEventId: event.eventId,
        contractId: event.contractId,
        organizationId: event.organizationId,
        lastLatitude: event.latitude ?? null,
        lastLongitude: event.longitude ?? null,
      },
      at,
      tx,
    );
    // A concurrent SOS of the same device created it first: join that episode.
    if (!created) return this.repository.appendEvent(incident, event, tx);
    await this.repository.insertTransition(
      {
        incidentId: incident.id,
        fromState: null,
        toState: 'DETECTED',
        reason: 'CREATED',
        refEventId: event.eventId,
        createdAt: at,
      },
      tx,
    );
    const route = await this.routing.route(event, at, tx);
    return this.lifecycle.apply(
      incident.id,
      'DETECTED',
      route.to,
      { kind: 'SYSTEM' },
      { code: 'ROUTED', at, recipients: route.recipients, refEventId: event.eventId },
      tx,
    );
  }
}
