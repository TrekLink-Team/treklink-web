import { Injectable } from '@nestjs/common';
import { Incident, IncidentState, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

export type NewIncident = Pick<
  Prisma.IncidentUncheckedCreateInput,
  | 'deviceId'
  | 'source'
  | 'confidence'
  | 'firstEventAt'
  | 'lastEventAt'
  | 'openedByEventId'
  | 'contractId'
  | 'organizationId'
  | 'lastLatitude'
  | 'lastLongitude'
  | 'lastPositionAt'
>;

export interface IncidentInsertResult {
  incident: Incident;
  created: boolean;
}

export type DueTimer = 'tierDeadlineAt' | 'statusDueAt' | 'reopenWindowEndsAt';

// Writes require the caller's transaction: routing, history and outbox must commit together.
@Injectable()
export class IncidentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async lockById(id: string, tx: Prisma.TransactionClient): Promise<Incident | null> {
    const rows = await tx.$queryRaw<
      Incident[]
    >`SELECT * FROM "incidents" WHERE "id" = ${id} FOR UPDATE`;
    return rows[0] ?? null;
  }

  async compareAndSet(
    current: Pick<Incident, 'id' | 'state' | 'version'>,
    patch: Prisma.IncidentUncheckedUpdateManyInput,
    tx: Prisma.TransactionClient,
  ): Promise<Incident | null> {
    const { count } = await tx.incident.updateMany({
      where: { id: current.id, state: current.state, version: current.version },
      data: { ...patch, version: { increment: 1 } },
    });
    return count === 1 ? tx.incident.findUniqueOrThrow({ where: { id: current.id } }) : null;
  }

  // Called with the incident row locked, so the next sequence belongs to this transaction.
  async insertTransition(
    data: Omit<Prisma.IncidentTransitionUncheckedCreateInput, 'seq'>,
    tx: Prisma.TransactionClient,
  ) {
    const latest = await tx.incidentTransition.aggregate({
      where: { incidentId: data.incidentId },
      _max: { seq: true },
    });
    return tx.incidentTransition.create({ data: { ...data, seq: (latest._max.seq ?? 0) + 1 } });
  }

  async insertStatusUpdate(
    data: Prisma.IncidentStatusUpdateUncheckedCreateInput,
    tx: Prisma.TransactionClient,
  ) {
    return tx.incidentStatusUpdate.create({ data });
  }

  // The update a correction names, with its correction if one exists (dry run defect 15). Read
  // under the incident row lock, so two corrections of one update cannot both pass the check.
  findStatusUpdateForCorrection(id: string, tx: Prisma.TransactionClient) {
    return tx.incidentStatusUpdate.findUnique({
      where: { id },
      select: { id: true, incidentId: true, correctedBy: { select: { id: true } } },
    });
  }

  // A status note is not a transition: the deadline moves, the version stays (task 4.1, Q2), so the
  // owner's expectedVersion for resolve remains valid. Called with the incident row locked.
  async resetStatusDue(id: string, statusDueAt: Date, tx: Prisma.TransactionClient) {
    return tx.incident.update({ where: { id }, data: { statusDueAt } });
  }

  // The device-silent flag (FR-INC-13, task 4.4) is not a transition: state, owner, deadlines and
  // version stay, so a member's pending action keeps its expectedVersion. Called with the row locked.
  async setStale(id: string, stale: boolean, tx: Prisma.TransactionClient): Promise<Incident> {
    return tx.incident.update({ where: { id }, data: { stale } });
  }

  // Incidents of an organization that are not CLOSED (organizations api-design 03 `openIncidents`).
  countOpenOfOrganization(
    organizationId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<number> {
    return client.incident.count({ where: { organizationId, state: { not: 'CLOSED' } } });
  }

  // The incidents outside CLOSED on a contract or its devices, oldest first (rentals api-design 20).
  openFor(
    contractId: string,
    deviceIds: readonly string[],
    client: Prisma.TransactionClient,
  ): Promise<{ id: string; code: string }[]> {
    return client.incident.findMany({
      where: {
        state: { not: 'CLOSED' },
        OR: [{ contractId }, { deviceId: { in: [...deviceIds] } }],
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, code: true },
    });
  }

  // An SOS joining an open episode (design §4 steps 4 and 5): the SOS count, the last SOS time and
  // the CONFIRMED upgrade. An SOS text carries no position (FGT); positions arrive through
  // `movePosition`. State and version stay, like a status note, so a member's expectedVersion stays
  // valid. Called with the incident row locked.
  async appendEvent(
    current: Pick<Incident, 'id' | 'lastEventAt'>,
    occurredAt: Date,
    tx: Prisma.TransactionClient,
  ): Promise<Incident> {
    return tx.incident.update({
      where: { id: current.id },
      data: {
        eventCount: { increment: 1 },
        confidence: 'CONFIRMED',
        ...(occurredAt > current.lastEventAt ? { lastEventAt: occurredAt } : {}),
      },
    });
  }

  // A position of the episode (onPosition): it becomes the last known position when the incident has
  // none yet, or when its fix is not older than the stored fix (`lastPositionAt`), so an
  // out-of-order packet never overwrites a newer position (PR #114 review). Counters, state and
  // version stay. Null when the fix is older. Called with the incident row locked.
  async movePosition(
    current: Pick<Incident, 'id' | 'lastPositionAt'>,
    position: { occurredAt: Date; latitude: number; longitude: number },
    tx: Prisma.TransactionClient,
  ): Promise<Incident | null> {
    if (current.lastPositionAt !== null && position.occurredAt < current.lastPositionAt)
      return null;
    return tx.incident.update({
      where: { id: current.id },
      data: {
        lastLatitude: position.latitude,
        lastLongitude: position.longitude,
        lastPositionAt: position.occurredAt,
      },
    });
  }

  // api-design 01 order (D-059 rule 7): most urgent deadline first, nulls last, then newest episode.
  async page(
    where: Prisma.IncidentWhereInput,
    skip: number,
    take: number,
  ): Promise<[Incident[], number]> {
    return this.prisma.$transaction([
      this.prisma.incident.findMany({
        where,
        orderBy: [{ tierDeadlineAt: { sort: 'asc', nulls: 'last' } }, { firstEventAt: 'desc' }],
        skip,
        take,
      }),
      this.prisma.incident.count({ where }),
    ]);
  }

  // Task 3.1 (design §6): incidents in one of the states whose deadline has passed, oldest deadline
  // first, over the (state, deadline) indexes. A null deadline never matches.
  // Generic over the requested states: the rows are filtered to them, so `state` narrows to S.
  async dueTimers<S extends IncidentState>(
    states: S[],
    column: DueTimer,
    now: Date,
    take: number,
  ): Promise<{ id: string; state: S; organizationId: string | null }[]> {
    const rows = await this.prisma.incident.findMany({
      where: { state: { in: states }, [column]: { lte: now } },
      orderBy: { [column]: 'asc' },
      take,
      select: { id: true, state: true, organizationId: true },
    });
    return rows as { id: string; state: S; organizationId: string | null }[];
  }

  findById(id: string): Promise<Incident | null> {
    return this.prisma.incident.findUnique({ where: { id } });
  }

  // Newest first (api-design 02).
  statusUpdates(incidentId: string) {
    return this.prisma.incidentStatusUpdate.findMany({
      where: { incidentId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        note: true,
        authorId: true,
        createdAt: true,
        correctsId: true,
        correctedBy: { select: { id: true } },
      },
    });
  }

  authorityReports(incidentId: string) {
    return this.prisma.authorityReport.findMany({
      where: { incidentId },
      orderBy: { reportedAt: 'desc' },
      select: { id: true, agency: true, reference: true, reportedAt: true, caseClosedAt: true },
    });
  }

  // The append-only trail in sequence order (api-design 12).
  transitions(incidentId: string) {
    return this.prisma.incidentTransition.findMany({
      where: { incidentId },
      orderBy: { seq: 'asc' },
      select: {
        seq: true,
        fromState: true,
        toState: true,
        actorId: true,
        reason: true,
        note: true,
        createdAt: true,
      },
    });
  }

  // Every alert row of the incident, oldest first (api-design 14).
  alertDeliveries(incidentId: string) {
    return this.prisma.alertDelivery.findMany({
      where: { incidentId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        kind: true,
        tier: true,
        recipientId: true,
        channel: true,
        status: true,
        attempts: true,
        sentAt: true,
        lastError: true,
      },
    });
  }

  // The latest acknowledgement, for MSG27: `acknowledgedAt` keeps the first one after a takeover.
  latestAcknowledgement(incidentId: string) {
    return this.prisma.incidentTransition.findFirst({
      where: { incidentId, toState: 'ACKNOWLEDGED' },
      orderBy: { seq: 'desc' },
      select: { actorId: true, createdAt: true },
    });
  }

  // Incidents not yet CLOSED on the devices, newest first (monitoring reads, design §5).
  openOfDevices(deviceIds: readonly string[]) {
    return this.prisma.incident.findMany({
      where: { deviceId: { in: [...deviceIds] }, state: { not: 'CLOSED' } },
      orderBy: { firstEventAt: 'desc' },
      select: { id: true, code: true, state: true, deviceId: true, organizationId: true },
    });
  }

  // ACKNOWLEDGED and RESPONDING incidents this account owns, for the owner deactivation (REQ-EVT-11).
  ownedActive(ownerId: string) {
    return this.prisma.incident.findMany({
      where: { ownerId, state: { in: ['ACKNOWLEDGED', 'RESPONDING'] } },
      orderBy: { firstEventAt: 'asc' },
      select: { id: true, state: true, organizationId: true },
    });
  }

  async lockOpenByDevice(deviceId: string, tx: Prisma.TransactionClient): Promise<Incident | null> {
    const rows = await tx.$queryRaw<Incident[]>`
      SELECT * FROM "incidents"
      WHERE "deviceId" = ${deviceId} AND "state" <> 'CLOSED'
      FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  // The device lock of the cadence rule when the device has no incident to lock (design §4): a
  // transaction-scoped advisory lock, released at commit or rollback, on a key of its own.
  async lockDeviceCadence(deviceId: string, tx: Prisma.TransactionClient): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`incidents:cadence:${deviceId}`}))`;
  }

  // When the device's latest incident closed, or null: positions up to then belong to closed
  // episodes and never open a cadence incident (REQ-EVT-02, one incident per burst).
  async lastClosedAt(deviceId: string, tx: Prisma.TransactionClient): Promise<Date | null> {
    const latest = await tx.incident.aggregate({
      where: { deviceId, state: 'CLOSED' },
      _max: { closedAt: true },
    });
    return latest._max.closedAt;
  }

  async insert(
    data: NewIncident,
    at: Date,
    tx: Prisma.TransactionClient,
  ): Promise<IncidentInsertResult> {
    const code = await this.nextCode(at, tx);
    // A caught unique violation still aborts a Postgres transaction. Recover the subtransaction
    // before returning the winning incident to ingress's correlation path (task 2.3).
    await tx.$executeRaw`SAVEPOINT incident_insert`;
    let incident: Incident;
    try {
      incident = await tx.incident.create({
        data: { ...data, code, stateChangedAt: at, createdAt: at },
      });
    } catch (error) {
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT incident_insert`;
      await tx.$executeRaw`RELEASE SAVEPOINT incident_insert`;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = error.meta?.target;
        if (
          target === 'incidents_one_open_per_device' ||
          (Array.isArray(target) && target.length === 1 && target[0] === 'deviceId')
        ) {
          const existing = await this.lockOpenByDevice(data.deviceId, tx);
          if (existing) return { incident: existing, created: false };
        }
      }
      // Code, event-id, FK and connection failures are not correlation conflicts.
      throw error;
    }
    await tx.$executeRaw`RELEASE SAVEPOINT incident_insert`;
    return { incident, created: true };
  }

  private async nextCode(at: Date, tx: Prisma.TransactionClient): Promise<string> {
    const year = at.getUTCFullYear();
    if (!Number.isInteger(year) || year < 0 || year > 9999) {
      throw new RangeError('Incident creation requires a valid four-digit UTC year.');
    }
    const prefix = `INC-${String(year).padStart(4, '0')}-`;
    // Deliberate ceiling: serializes creations in one year until their outer transactions finish.
    // Revisit with a dedicated allocator if ingestion throughput makes this lock a bottleneck.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`incidents:code:${year}`}))`;
    const latest = await tx.incident.findFirst({
      where: { code: { startsWith: prefix } },
      orderBy: { code: 'desc' },
      select: { code: true },
    });
    const sequence = latest ? Number(latest.code.slice(prefix.length)) + 1 : 1;
    if (!Number.isInteger(sequence) || sequence < 1 || sequence > 999999) {
      throw new RangeError(`Incident code range exhausted or invalid for ${year}.`);
    }
    return `${prefix}${String(sequence).padStart(6, '0')}`;
  }
}
