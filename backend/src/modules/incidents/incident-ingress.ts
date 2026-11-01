import { Injectable } from '@nestjs/common';
import { Incident, IncidentSource, Prisma } from '@prisma/client';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
import { IncidentLifecycle, tierOf } from './incident-lifecycle';
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

// A plotted position as gateway-sync stores it, with its attribution at the occurrence time (D-040),
// which routes a cadence-inferred incident exactly as an SOS is routed (REQ-EVT-03).
export interface PositionEvent extends Attribution {
  eventId: string;
  deviceId: string;
  occurredAt: Date;
  latitude: number;
  longitude: number;
}

// The cadence count reads field events, which gateway-sync owns, so the caller answers it (design §4):
// the occurrence times of the device's stored plotted positions in [from, to], oldest first, the
// position being handed over included. incidents never reads `field_events` itself.
export interface PositionHistory {
  plottedPositionTimes(
    deviceId: string,
    from: Date,
    to: Date,
    tx: Prisma.TransactionClient,
  ): Promise<Date[]>;
}

// REQ-EVT-02: the start of the earliest window of `windowMs` that contains `at` and holds at least
// `count` of `times` (sorted oldest first), or null. Both window edges count, so positions exactly
// `windowMs` apart are in one window. Only windows containing `at` are checked: whichever position of
// a burst arrives last completes it, and every earlier one is stored by then, so a burst is found on
// arrival even when its positions arrive out of order (FR-EVT-15).
export const cadenceBurstStart = (
  times: readonly Date[],
  at: Date,
  windowMs: number,
  count: number,
): Date | null => {
  const t = at.getTime();
  let end = 0;
  for (let start = 0; start < times.length; start++) {
    const from = times[start].getTime();
    if (from > t) break;
    if (from + windowMs < t) continue;
    if (end < start) end = start;
    while (end + 1 < times.length && times[end + 1].getTime() - from <= windowMs) end++;
    if (end - start + 1 >= count) return times[start];
  }
  return null;
};

const REOPENABLE = new Set(['RESOLVED', 'FALSE_ALARM']);
const NO_RECIPIENTS = { primary: [], backup: [], managers: [], staff: [] };

// Task 2.3 (design §4). gateway-sync calls `onSos` and `onPosition` inside the ingestion transaction,
// so the incident, its history, the outbox rows and the field event commit together. A replayed
// packet never reaches here: ingestion rejects it as a duplicate first (REQ-ERR-03). A burst of
// positions with no open incident opens a SUSPECTED one from CADENCE_INFERRED (REQ-EVT-02), routed and
// alerted like any new incident; a later SOS joins it and upgrades it to CONFIRMED in place.
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
    return this.append(open, event.occurredAt, tx);
  }

  // A position joins the device's running episode: one that is not RESOLVED or FALSE_ALARM, and not
  // more than `gatewaySync.retroTagGraceSeconds` older than its first SOS. With no incident outside
  // CLOSED, it counts toward the cadence rule instead (REQ-EVT-02). Returns the incident it joined or
  // opened, or null; the caller links its field event to that incident. A moved last position is
  // announced with `incident.changed` after commit, for the live map.
  async onPosition(
    event: PositionEvent,
    tx: Prisma.TransactionClient,
    history: PositionHistory,
  ): Promise<Incident | null> {
    const open = await this.repository.lockOpenByDevice(event.deviceId, tx);
    if (open) return this.join(open, event, tx);
    // No incident row to lock (design §4 step 1), so the device's cadence checks are serialised for
    // the rest of this transaction instead: two positions of one burst then count each other, and the
    // second one finds the incident the first one opened.
    await this.repository.lockDeviceCadence(event.deviceId, tx);
    const opened = await this.repository.lockOpenByDevice(event.deviceId, tx);
    if (opened) return this.join(opened, event, tx);
    return this.cadence(event, tx, history);
  }

  private async join(
    open: Incident,
    event: PositionEvent,
    tx: Prisma.TransactionClient,
  ): Promise<Incident | null> {
    if (REOPENABLE.has(open.state)) return null;
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

  // REQ-EVT-02: `incidents.cadenceCount` plotted positions inside `incidents.cadenceWindowSeconds`
  // open a SUSPECTED incident. Only positions that occurred after the device's last incident closed
  // count, so one burst opens one incident: the positions that opened or joined an episode never open
  // a second one once it is CLOSED. Called under the device's cadence lock with no incident open.
  private async cadence(
    event: PositionEvent,
    tx: Prisma.TransactionClient,
    history: PositionHistory,
  ): Promise<Incident | null> {
    const count = await this.parameters.get('incidents.cadenceCount', tx);
    const windowMs = (await this.parameters.get('incidents.cadenceWindowSeconds', tx)) * 1000;
    const at = event.occurredAt.getTime();
    const closedAt = await this.repository.lastClosedAt(event.deviceId, tx);
    const times = (
      await history.plottedPositionTimes(
        event.deviceId,
        new Date(at - windowMs),
        new Date(at + windowMs),
        tx,
      )
    ).filter((time) => closedAt === null || time > closedAt);
    const start = cadenceBurstStart(times, event.occurredAt, windowMs, count);
    return start ? this.openSuspected(event, start, tx) : null;
  }

  // Step 2 for a cadence burst: create in DETECTED with transition 1, then route as transition 2,
  // exactly as an SOS is routed (REQ-EVT-03, design §2). The burst's first position is the first event,
  // so later positions of the burst still join it within the retro-tag grace.
  private async openSuspected(
    event: PositionEvent,
    burstStart: Date,
    tx: Prisma.TransactionClient,
  ): Promise<Incident | null> {
    const at = new Date();
    const { incident, created } = await this.repository.insert(
      {
        deviceId: event.deviceId,
        source: 'CADENCE_INFERRED',
        confidence: 'SUSPECTED',
        firstEventAt: burstStart,
        lastEventAt: event.occurredAt,
        openedByEventId: event.eventId,
        contractId: event.contractId,
        organizationId: event.organizationId,
        lastLatitude: event.latitude,
        lastLongitude: event.longitude,
        lastPositionAt: event.occurredAt,
      },
      at,
      tx,
    );
    // A concurrent SOS of the device created one first: the position joins that episode.
    if (!created) return this.join(incident, event, tx);
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

  // An SOS joining an open episode. Upgrading a SUSPECTED incident to CONFIRMED in place
  // (REQ-EVT-02) changes no state, so it is announced here for the queue and the detail.
  private async append(
    open: Incident,
    occurredAt: Date,
    tx: Prisma.TransactionClient,
  ): Promise<Incident> {
    const joined = await this.repository.appendEvent(open, occurredAt, tx);
    if (open.confidence === 'SUSPECTED')
      this.events.emitAfterCommit('incident.changed', {
        incidentId: joined.id,
        deviceId: joined.deviceId,
        organizationId: joined.organizationId,
        state: joined.state,
        tier: tierOf(joined.state),
        ownerId: joined.ownerId,
      });
    return joined;
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
    // A concurrent SOS or cadence burst of the same device created it first: join that episode.
    if (!created) return this.append(incident, event.occurredAt, tx);
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
