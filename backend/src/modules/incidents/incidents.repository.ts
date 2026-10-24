import { Injectable } from '@nestjs/common';
import { Incident, Prisma } from '@prisma/client';

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
>;

export interface IncidentInsertResult {
  incident: Incident;
  created: boolean;
}

// Writes require the caller's transaction: routing, history and outbox must commit together.
@Injectable()
export class IncidentsRepository {
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

  async lockOpenByDevice(deviceId: string, tx: Prisma.TransactionClient): Promise<Incident | null> {
    const rows = await tx.$queryRaw<Incident[]>`
      SELECT * FROM "incidents"
      WHERE "deviceId" = ${deviceId} AND "state" <> 'CLOSED'
      FOR UPDATE
    `;
    return rows[0] ?? null;
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
