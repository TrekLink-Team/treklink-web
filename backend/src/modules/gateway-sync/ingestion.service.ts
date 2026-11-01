import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { AttributionState, EventKind, IngressPath, Prisma, SyncOutcome } from '@prisma/client';
import { DevicesService } from '../devices';
import { IncidentIngress } from '../incidents';
import { FieldStationsService } from '../organizations';
import { ContractsService } from '../rentals';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
import { attribute, stationMayDeliver, UNATTRIBUTED_DETAIL } from './attribution';
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
// handed to `IncidentIngress.onSos` in the same transaction, and a plotted position to `onPosition`;
// the stored event is linked to the incident it opened or joined (incidents 2.3, MF-03).
//
// A Field Station envelope (Stage C) names its station by username, resolved through
// `organizations` (`FieldStationsService.stationByUsername`, no secret hash). The station must be known and not revoked, and
// its organization must hold the device or have returned it within the late-upload grace
// (REQ-EVT-05); otherwise the attempt ends `NOT_RENTED_TO_STATION_ORG`. Its occurrence time is the
// corrected station capture time, and it is attributed only to an interval of the station's
// organization (REQ-EVT-15, REQ-ERR-06).
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
    private readonly stations: FieldStationsService,
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
    const { packet, ingress, uplinkKey, receivedAt, message, station: stationTimes } = envelope;
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

    const [bounds, maxSpeedKmh, deviceTimeMaxAheadSeconds, lateUploadGraceHours, marginSeconds] =
      await Promise.all([
        this.parameters.get('monitoring.positionBounds'),
        this.parameters.get('monitoring.maxPlausibleSpeedKmh'),
        this.parameters.get('gatewaySync.deviceTimeMaxAheadSeconds'),
        this.parameters.get('gatewaySync.lateUploadGraceHours'),
        this.parameters.get('gatewaySync.attributionMarginSeconds'),
      ]);

    // Stage C (REQ-EVT-05, task 2.5): the station behind the username, and whether its organization
    // may deliver this device, before the packet is decoded (contract, Activity Diagram).
    let station: { id: string; organizationId: string } | null = null;
    if (ingress === IngressPath.FIELD_STATION) {
      const resolved = await this.resolveStation(
        uplinkKey,
        device.id,
        receivedAt,
        lateUploadGraceHours,
      );
      if (typeof resolved === 'string') {
        await this.repository.insertAudit({
          ...audit,
          deviceId: device.id,
          outcome: SyncOutcome.NOT_RENTED_TO_STATION_ORG,
          detail: resolved,
        });
        return SyncOutcome.NOT_RENTED_TO_STATION_ORG;
      }
      station = resolved;
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

    const time = occurrenceTime(
      packet.timestamp,
      receivedAt,
      { deviceTimeMaxAheadSeconds, lateUploadGraceHours },
      station ? stationTimes : undefined,
    );

    // Attribution (task 2.4, D-040, `attribution.ts`): the custody interval holding the device at the
    // occurrence time, clear of the margin around its handover and end; anything else stays
    // UNATTRIBUTED and reaches the fleet stream only (BR-36). Read before the transaction: custody
    // changes only at a handover, check-in or loss, never because of a field event.
    const custody = await this.contracts.custodyAt(device.id, time.occurredAt);
    const attribution = attribute({
      custody,
      occurredAt: time.occurredAt,
      marginSeconds,
      station,
    });
    const attributed = attribution.attributed ? attribution : null;

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
          fieldStationId: station?.id ?? null,
          capturedAt: station && stationTimes ? new Date(stationTimes.capturedAtMs) : null,
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
          },
          tx,
        );
        await this.repository.linkIncident(eventId, incident.id, tx);
      } else if (position && plotted) {
        const joined = await this.incidents.onPosition(
          {
            deviceId: device.id,
            occurredAt: time.occurredAt,
            latitude: position.latitude,
            longitude: position.longitude,
          },
          tx,
        );
        if (joined) await this.repository.linkIncident(eventId, joined.id, tx);
      }
      // The reason an accepted event stays UNATTRIBUTED goes in the detail (REQ-ERR-06).
      const detail =
        outcome === SyncOutcome.ACCEPTED_UNATTRIBUTED && !attribution.attributed
          ? UNATTRIBUTED_DETAIL[attribution.reason]
          : undefined;
      await this.repository.insertAudit({ ...audit, deviceId: device.id, outcome, detail }, tx);

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

  // The station of a Field Station envelope when it may deliver the device's events, else the audit
  // detail of the refusal. A revoked or unknown username is refused like a station whose
  // organization does not hold the device (interim, pending the leader's ruling on its own outcome).
  private async resolveStation(
    username: string,
    deviceId: string,
    receivedAt: Date,
    lateUploadGraceHours: number,
  ): Promise<{ id: string; organizationId: string } | string> {
    const station = await this.stations.stationByUsername(username);
    if (!station) return `unknown Field Station ${username}`;
    if (station.revokedAt) return `Field Station ${username} is revoked`;
    const periods = await this.contracts.rentalPeriods(deviceId, station.organizationId);
    if (!stationMayDeliver(periods, receivedAt, lateUploadGraceHours)) {
      return `the organization of Field Station ${username} neither holds the device nor returned it within the late-upload grace`;
    }
    return { id: station.id, organizationId: station.organizationId };
  }
}
