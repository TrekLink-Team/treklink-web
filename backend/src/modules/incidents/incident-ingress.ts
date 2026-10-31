import { Injectable } from '@nestjs/common';
import { Incident, IncidentSource, Prisma } from '@prisma/client';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
import { IncidentLifecycle } from './incident-lifecycle';
import { IncidentsRepository } from './incidents.repository';
import { Attribution, RoutingService } from './routing.service';

// An SOS as gateway-sync stores it: the field event and its attribution at the occurrence time
// (D-040). The SOS text carries no position; the fix rides a separate POSITION_APP packet (FGT).
export interface SosEvent extends Attribution {
  eventId: string;
  deviceId: string;
  source: Extract<IncidentSource, 'DEVICE_SOS' | 'DEVICE_FALL'>;
  occurredAt: Date;
}

// A plotted position as gateway-sync stores it.
export interface PositionEvent {
  deviceId: string;
  occurredAt: Date;
  latitude: number;
  longitude: number;
}

const REOPENABLE = new Set(['RESOLVED', 'FALSE_ALARM']);
const NO_RECIPIENTS = { primary: [], backup: [], managers: [], staff: [] };

// Task 2.3 (design §4). gateway-sync calls `onSos` and `onPosition` inside the ingestion transaction,
// so the incident, its history, the outbox rows and the field event commit together. A replayed
// packet never reaches here: ingestion rejects it as a duplicate first (REQ-ERR-03). Cadence
// (SUSPECTED creation from positions alone) is not built yet.
@Injectable()
export class IncidentIngress {
  constructor(
    private readonly repository: IncidentsRepository,
    private readonly lifecycle: IncidentLifecycle,
    private readonly routing: RoutingService,
    private readonly parameters: ParameterService,
    private readonly events: TransactionalEvents,
  ) {}

  // Returns the incident the event opened or joined; the caller links its field event to it.
  async onSos(event: SosEvent, tx: Prisma.TransactionClient): Promise<Incident> {
    const at = new Date();
    // Step 1: the device's incident outside CLOSED, locked.
    const open = await this.repository.lockOpenByDevice(event.deviceId, tx);
    if (!open) return this.open(event, at, tx);
    // Step 3: a resolved or false-alarm episode. A person already ended it, and no packet ever does
    // (REQ-UBI-05, D-038 rule 2). An SOS that occurred before the episode ended is recorded on it below.
    if (REOPENABLE.has(open.state) && event.occurredAt >= open.stateChangedAt) {
      const ends = open.reopenWindowEndsAt;
      // Past the window on both clocks (server and occurrence): the window has genuinely ended, so the
      // system closes the episode exactly as the closeAfterReopenWindow job (task 3.1) would, and the
      // SOS opens a new incident in this transaction (REQ-EVT-10).
      if (ends && ends <= at && event.occurredAt >= ends) {
        await this.lifecycle.apply(
          open.id,
          open.state,
          'CLOSED',
          { kind: 'SYSTEM' },
          { code: 'REOPEN_WINDOW_ENDED', at, recipients: NO_RECIPIENTS, refEventId: event.eventId },
          tx,
        );
        return this.open(event, at, tx);
      }
      // Inside the window, or a window never set: the device reopens the episode, re-routed as at
      // creation, so an unattributed SOS or an organization with nobody to alert reopens to UNROUTED.
      await this.repository.appendEvent(open, event.occurredAt, tx);
      const route = await this.routing.route(event, at, tx);
      return this.lifecycle.apply(
        open.id,
        open.state,
        route.to,
        { kind: 'DEVICE' },
        {
          code: 'REOPENED',
          at,
          recipients: route.recipients,
          refEventId: event.eventId,
          occurredAt: event.occurredAt,
          route: { organizationId: event.organizationId, contractId: event.contractId },
        },
        tx,
      );
    }
    // Steps 4 and 5: any other open episode is the same emergency still running. A late SOS that
    // occurred before the episode ended is recorded on it.
    return this.repository.appendEvent(open, event.occurredAt, tx);
  }

  // A position joins the device's running episode: one that is not RESOLVED or FALSE_ALARM, and not
  // more than `gatewaySync.retroTagGraceSeconds` older than its first SOS. Returns the incident it
  // joined, or null; the caller links its field event to a joined incident. A moved last position
  // is announced with `incident.changed` after commit, for the live map.
  async onPosition(event: PositionEvent, tx: Prisma.TransactionClient): Promise<Incident | null> {
    const open = await this.repository.lockOpenByDevice(event.deviceId, tx);
    if (!open || REOPENABLE.has(open.state)) return null;
    const graceSeconds = await this.parameters.get('gatewaySync.retroTagGraceSeconds', tx);
    if (event.occurredAt.getTime() < open.firstEventAt.getTime() - graceSeconds * 1000) return null;
    const moved = await this.repository.movePosition(open, event, tx);
    if (moved)
      this.events.emitAfterCommit('incident.changed', {
        incidentId: moved.id,
        deviceId: moved.deviceId,
        organizationId: moved.organizationId,
        state: moved.state,
        tier: null,
        ownerId: moved.ownerId,
      });
    return moved ?? open;
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
      },
      at,
      tx,
    );
    // A concurrent SOS of the same device created it first: join that episode.
    if (!created) return this.repository.appendEvent(incident, event.occurredAt, tx);
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
