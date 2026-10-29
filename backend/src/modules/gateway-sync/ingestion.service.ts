import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { AttributionState, EventKind, IngressPath, Prisma, SyncOutcome } from '@prisma/client';
import { DevicesService } from '../devices';
import { IncidentIngress } from '../incidents';
import { ContractsService } from '../rentals';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
import { CanonicalEnvelope } from './canonical-envelope';
import {
  FIELD_POSITION,
  FIELD_TELEMETRY,
  FieldPositionEvent,
  FieldTelemetryEvent,
} from './field-events';
import { IngestionRepository } from './ingestion.repository';
import { NormalizedReading } from './normalizer/normalized-reading';
import { Normalizer } from './normalizer/normalizer';
import { occurrenceTime } from './occurrence-time';
import { isImplausibleMove, isValidPosition, toBounds } from './position-rules';

// D-006: one identity per mesh packet, whichever path delivers it.
export const eventIdOf = (from: number, id: number): string =>
  createHash('sha256').update(`${from}:${id}`).digest('hex');

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

// The one writer of field events (tasks 2.2 and 2.3, design §2). Every attempt leaves one audit row.
//
// Attribution (task 2.4) asks `rentals` for the custody interval at the occurrence time. An SOS is
// handed to `IncidentIngress.onSos` in the same transaction, and the stored event is linked to the
// incident it opened or joined (incidents 2.3, MF-03). The position hand-off, `onPosition`, joins later.
@Injectable()
export class IngestionService {
  constructor(
    private readonly repository: IngestionRepository,
    private readonly devices: DevicesService,
    private readonly contracts: ContractsService,
    private readonly incidents: IncidentIngress,
    private readonly normalizer: Normalizer,
    private readonly parameters: ParameterService,
    private readonly events: TransactionalEvents,
  ) {}

  // Records a message that failed envelope validation (REQ-ERR-01).
  async rejectMalformed(
    ingress: IngressPath,
    uplinkKey: string | null,
    detail: string,
    raw: unknown,
  ): Promise<SyncOutcome> {
    await this.repository.insertAudit({
      ingress,
      uplinkKey,
      outcome: SyncOutcome.MALFORMED_ENVELOPE,
      detail,
      rawMessage: raw as Prisma.InputJsonValue,
    });
    return SyncOutcome.MALFORMED_ENVELOPE;
  }

  async ingest(envelope: CanonicalEnvelope): Promise<SyncOutcome> {
    const { packet, ingress, uplinkKey, receivedAt, message } = envelope;
    const eventId = eventIdOf(packet.from, packet.id);
    const nodeNum = BigInt(packet.from);
    const rawMessage = message as Prisma.InputJsonValue;
    const audit = { eventId, nodeNum, ingress, uplinkKey };

    const device = await this.devices.byNodeNum(nodeNum);
    if (!device) {
      await this.repository.insertAudit({
        ...audit,
        outcome: SyncOutcome.UNKNOWN_DEVICE,
        rawMessage,
      });
      return SyncOutcome.UNKNOWN_DEVICE;
    }

    let reading: NormalizedReading;
    try {
      reading = this.normalizer.normalize(packet.type, packet.payload);
    } catch (error) {
      await this.repository.insertAudit({
        ...audit,
        deviceId: device.id,
        outcome: SyncOutcome.NORMALIZATION_FAILED,
        detail: errorText(error),
        rawMessage,
      });
      return SyncOutcome.NORMALIZATION_FAILED;
    }

    const [bounds, maxSpeedKmh, deviceTimeMaxAheadSeconds, lateUploadGraceHours, marginSeconds] =
      await Promise.all([
        this.parameters.get('monitoring.positionBounds'),
        this.parameters.get('monitoring.maxPlausibleSpeedKmh'),
        this.parameters.get('gatewaySync.deviceTimeMaxAheadSeconds'),
        this.parameters.get('gatewaySync.lateUploadGraceHours'),
        this.parameters.get('gatewaySync.attributionMarginSeconds'),
      ]);
    const time = occurrenceTime(packet.timestamp, receivedAt, {
      deviceTimeMaxAheadSeconds,
      lateUploadGraceHours,
    });

    // Attribution (task 2.4, D-040): the custody interval holding the device at the occurrence time,
    // clear of the margin around its handover and end; anything else stays UNATTRIBUTED and reaches
    // the fleet stream only (BR-36). Read before the transaction: custody changes only at a
    // handover, check-in or loss, never because of a field event.
    const custody = await this.contracts.custodyAt(device.id, time.occurredAt, marginSeconds);
    const attributed = custody !== null && !custody.nearBoundary ? custody : null;

    return this.events.transaction(async (tx) => {
      let outcome: SyncOutcome = attributed
        ? SyncOutcome.ACCEPTED
        : SyncOutcome.ACCEPTED_UNATTRIBUTED;
      let position = reading.position;
      let plotted = true;
      if (position && !isValidPosition(position, toBounds(bounds))) {
        position = undefined;
        outcome = SyncOutcome.INVALID_POSITION;
      } else if (position) {
        const last = await this.repository.lastPlottedPosition(device.id, tx);
        if (
          last &&
          isImplausibleMove(
            { ...last, at: last.occurredAt },
            { ...position, at: time.occurredAt },
            maxSpeedKmh,
          )
        ) {
          plotted = false;
          outcome = SyncOutcome.IMPLAUSIBLE_POSITION;
        }
      }

      const inserted = await this.repository.insertEventOnce(
        {
          eventId,
          deviceId: device.id,
          attribution: attributed ? AttributionState.ATTRIBUTED : AttributionState.UNATTRIBUTED,
          organizationId: attributed?.organizationId ?? null,
          contractDeviceId: attributed?.contractDeviceId ?? null,
          uplinkKey,
          ingress,
          kind: reading.kind,
          priority: reading.priority,
          observedAt: time.observedAt,
          occurredAt: time.occurredAt,
          timeSource: time.timeSource,
          receivedAt,
          latitude: position?.latitude ?? null,
          longitude: position?.longitude ?? null,
          altitude: position?.altitude ?? null,
          batteryPct: reading.batteryPct ?? null,
          rssi: packet.rssi ?? null,
          snr: packet.snr ?? null,
          hopsAway: packet.hops_away ?? null,
          plotted,
          payload: rawMessage,
        },
        tx,
      );
      if (!inserted) {
        await this.repository.insertAudit(
          { ...audit, deviceId: device.id, outcome: SyncOutcome.DUPLICATE_REJECTED },
          tx,
        );
        return SyncOutcome.DUPLICATE_REJECTED;
      }

      // A position or telemetry moves the device projection; an implausible position does not
      // (REQ-EVT-04). An out-of-bounds position still counts as the device being heard.
      const isReading = reading.position !== undefined || reading.kind === 'TELEMETRY';
      if (isReading && plotted) {
        await this.devices.projectReading(
          nodeNum,
          { at: time.occurredAt, position, batteryPct: reading.batteryPct },
          tx,
        );
      }
      if (reading.kind === EventKind.SOS || reading.kind === EventKind.FALL_SOS) {
        const incident = await this.incidents.onSos(
          {
            eventId,
            deviceId: device.id,
            source: reading.kind === EventKind.SOS ? 'DEVICE_SOS' : 'DEVICE_FALL',
            occurredAt: time.occurredAt,
            organizationId: attributed?.organizationId ?? null,
            contractId: attributed?.contractId ?? null,
            ...(position && plotted
              ? { latitude: position.latitude, longitude: position.longitude }
              : {}),
          },
          tx,
        );
        await this.repository.linkIncident(eventId, incident.id, tx);
      }
      await this.repository.insertAudit({ ...audit, deviceId: device.id, outcome }, tx);

      const at = time.occurredAt.toISOString();
      if (position) {
        this.events.emitAfterCommit(FIELD_POSITION, {
          deviceId: device.id,
          organizationId: attributed?.organizationId ?? null,
          lat: position.latitude,
          lon: position.longitude,
          at,
          plotted,
        } satisfies FieldPositionEvent);
      }
      if (reading.batteryPct !== undefined) {
        this.events.emitAfterCommit(FIELD_TELEMETRY, {
          deviceId: device.id,
          organizationId: attributed?.organizationId ?? null,
          batteryPct: reading.batteryPct,
          at,
        } satisfies FieldTelemetryEvent);
      }
      return outcome;
    });
  }
}
