import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { AttributionState, IngressPath, Prisma, SyncOutcome } from '@prisma/client';
import { DevicesService } from '../devices';
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
// Iteration 1 (D-058): `rentals` and `incidents` do not exist yet, so every event is UNATTRIBUTED
// (outcome ACCEPTED_UNATTRIBUTED, fleet stream only) and an SOS is stored without the incidents hand-off.
// Attribution (task 2.4) and IncidentsService.onSos and onPosition (task 2.3) join here, in the same
// transaction, when those modules land.
@Injectable()
export class IngestionService {
  constructor(
    private readonly repository: IngestionRepository,
    private readonly devices: DevicesService,
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

    const [bounds, maxSpeedKmh, deviceTimeMaxAheadSeconds, lateUploadGraceHours] =
      await Promise.all([
        this.parameters.get('monitoring.positionBounds'),
        this.parameters.get('monitoring.maxPlausibleSpeedKmh'),
        this.parameters.get('gatewaySync.deviceTimeMaxAheadSeconds'),
        this.parameters.get('gatewaySync.lateUploadGraceHours'),
      ]);
    const time = occurrenceTime(packet.timestamp, receivedAt, {
      deviceTimeMaxAheadSeconds,
      lateUploadGraceHours,
    });

    return this.events.transaction(async (tx) => {
      let outcome: SyncOutcome = SyncOutcome.ACCEPTED_UNATTRIBUTED;
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
          attribution: AttributionState.UNATTRIBUTED,
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
      await this.repository.insertAudit({ ...audit, deviceId: device.id, outcome }, tx);

      const at = time.occurredAt.toISOString();
      if (position) {
        this.events.emitAfterCommit(FIELD_POSITION, {
          deviceId: device.id,
          organizationId: null,
          lat: position.latitude,
          lon: position.longitude,
          at,
          plotted,
        } satisfies FieldPositionEvent);
      }
      if (reading.batteryPct !== undefined) {
        this.events.emitAfterCommit(FIELD_TELEMETRY, {
          deviceId: device.id,
          organizationId: null,
          batteryPct: reading.batteryPct,
          at,
        } satisfies FieldTelemetryEvent);
      }
      return outcome;
    });
  }
}
