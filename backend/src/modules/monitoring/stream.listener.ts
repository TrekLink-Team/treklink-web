import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  FIELD_POSITION,
  FIELD_TELEMETRY,
  type FieldPositionEvent,
  type FieldTelemetryEvent,
} from '../gateway-sync';
import { ParameterService } from '../platform/parameters/parameter.service';
import {
  DEVICE_CHECKED_IN,
  DEVICE_HANDED_OVER,
  DEVICE_LABEL_CHANGED,
  type DeviceCheckedInEvent,
  type DeviceHandedOverEvent,
  type DeviceLabelChangedEvent,
} from '../rentals';
import {
  DEVICE_STALE_CHANGED,
  STATION_STALE_CHANGED,
  type DeviceStaleChangedEvent,
  type StationStaleChangedEvent,
} from './stale-events';
import { StreamRepository } from './stream.repository';
import { StreamService } from './stream.service';

// `incidents` emits its event as a plain string, the name of platform design §2.3.
export const INCIDENT_CHANGED = 'incident.changed';

// In-process routing ids, not the WebSocket DTO (incidents emits only these today).
export interface IncidentChangedEvent {
  incidentId: string;
  /** The incident's device, so the live map updates its marker from the entry. */
  deviceId?: string | null;
  organizationId: string | null;
  state: string;
  tier: string | null;
  ownerId: string | null;
}

const asDate = (value: string | Date): Date => new Date(value);

// Turns domain events into stream entries (task 2.1, REQ-EVT-01). The organization of an entry comes
// with its event: a field event carries the organization attributed by occurrence time (D-040) and an
// incident its routed organization, so a device that moves from A to B never leaks A's entries to B
// (AC-01, AC-06). No lookup of the current holder is needed, because every event names its organization.
@Injectable()
export class StreamListener {
  // Last time a position was pushed for a device, for the per-device throttle.
  private readonly lastPositionPush = new Map<string, number>();
  // Latest check-in of a device from an organization, so a late field event can be flagged. Written on
  // check-in and read through from the `device_releases` table, which pruning the stream never touches.
  private readonly releases = new Map<string, Date | null>();

  constructor(
    private readonly stream: StreamService,
    private readonly repository: StreamRepository,
    private readonly parameters: ParameterService,
  ) {}

  @OnEvent(FIELD_POSITION)
  async onFieldPosition(event: FieldPositionEvent): Promise<void> {
    // A position marked not plotted is never drawn (REQ-UBI-03, FR-MON-04).
    if (!event.plotted) return;
    const late = await this.isLate(event.organizationId, event.deviceId, event.at);
    // A late entry is history for its custody interval, not a live marker, so it is not throttled.
    if (!late && (await this.throttled(event.deviceId))) return;
    await this.stream.publish({
      organizationId: event.organizationId,
      type: 'device.position',
      deviceId: event.deviceId,
      payload: { lat: event.lat, lon: event.lon, at: event.at, ...(late && { late: true }) },
    });
  }

  @OnEvent(FIELD_TELEMETRY)
  async onFieldTelemetry(event: FieldTelemetryEvent): Promise<void> {
    const late = await this.isLate(event.organizationId, event.deviceId, event.at);
    await this.stream.publish({
      organizationId: event.organizationId,
      type: 'device.telemetry',
      deviceId: event.deviceId,
      payload: { batteryPct: event.batteryPct, at: event.at, ...(late && { late: true }) },
    });
  }

  @OnEvent(INCIDENT_CHANGED)
  async onIncidentChanged(event: IncidentChangedEvent): Promise<void> {
    await this.stream.publish({
      organizationId: event.organizationId,
      type: 'incident.changed',
      // Additive: an entry stored before the field carries none, and the client then reloads the
      // snapshot (frontend useLiveMap).
      deviceId: event.deviceId ?? null,
      payload: {
        incidentId: event.incidentId,
        state: event.state,
        tier: event.tier,
        ownerId: event.ownerId,
      },
    });
  }

  @OnEvent(DEVICE_LABEL_CHANGED)
  async onDeviceLabelChanged(event: DeviceLabelChangedEvent): Promise<void> {
    await this.stream.publish({
      organizationId: event.organizationId,
      type: 'device.label',
      deviceId: event.deviceId,
      payload: { holder: event.holder },
    });
  }

  // The organization's map learns of a new device here; its first position follows.
  @OnEvent(DEVICE_HANDED_OVER)
  async onDeviceHandedOver(event: DeviceHandedOverEvent): Promise<void> {
    await this.stream.publish({
      organizationId: event.organizationId,
      type: 'device.handedOver',
      deviceId: event.deviceId,
      payload: { contractId: event.contractId, at: asDate(event.at).toISOString() },
    });
  }

  // The organization's map and API stop showing the device (FR-MON-08, E04-7). A field event that
  // occurred before this moment but synchronizes later is flagged late, and one that occurred after it
  // is attributed to nobody, so the organization receives nothing more about the device (REQ-EVT-04).
  @OnEvent(DEVICE_CHECKED_IN)
  async onDeviceCheckedIn(event: DeviceCheckedInEvent): Promise<void> {
    const checkedInAt = asDate(event.at);
    // Durable first: a late upload may arrive days after the stream entry is pruned (168 h against 72 h).
    await this.repository.recordRelease(event.organizationId, event.deviceId, checkedInAt);
    this.releases.set(this.releaseKey(event.organizationId, event.deviceId), checkedInAt);
    this.lastPositionPush.delete(event.deviceId);
    await this.stream.publish({
      organizationId: event.organizationId,
      type: 'device.released',
      deviceId: event.deviceId,
      // The contract lets a client refresh only that contract's invoice, as device.handedOver does.
      payload: { contractId: event.contractId, checkedInAt: checkedInAt.toISOString() },
    });
  }

  // A transition of the staleness sweep (task 2.4, REQ-EVT-03), emitted after its commit. Both carry the
  // last-seen time: the stale entry for the popup, the recovery so the map's own clock agrees with it.
  @OnEvent(DEVICE_STALE_CHANGED)
  async onDeviceStale(event: DeviceStaleChangedEvent): Promise<void> {
    await this.stream.publish({
      organizationId: event.organizationId,
      type: 'device.stale',
      deviceId: event.deviceId,
      payload: { stale: event.stale, lastSeenAt: event.lastSeenAt },
    });
  }

  @OnEvent(STATION_STALE_CHANGED)
  async onStationStale(event: StationStaleChangedEvent): Promise<void> {
    await this.stream.publish({
      organizationId: event.organizationId,
      type: 'station.stale',
      deviceId: null,
      payload: {
        fieldStationId: event.fieldStationId,
        stale: event.stale,
        lastSyncAt: event.lastSyncAt,
      },
    });
  }

  // True when the event occurred at or before the organization's latest check-in of the device.
  private async isLate(
    organizationId: string | null,
    deviceId: string,
    at: string,
  ): Promise<boolean> {
    if (organizationId === null) return false;
    const key = this.releaseKey(organizationId, deviceId);
    if (!this.releases.has(key)) {
      this.releases.set(key, await this.repository.latestRelease(organizationId, deviceId));
    }
    const release = this.releases.get(key);
    return release !== null && release !== undefined && new Date(at).getTime() <= release.getTime();
  }

  // Positions of one device go out at most once per `monitoring.positionEmitMinIntervalMs`.
  private async throttled(deviceId: string): Promise<boolean> {
    const interval = await this.parameters.get('monitoring.positionEmitMinIntervalMs');
    const now = Date.now();
    const last = this.lastPositionPush.get(deviceId);
    if (last !== undefined && now - last < interval) return true;
    this.lastPositionPush.set(deviceId, now);
    return false;
  }

  private releaseKey(organizationId: string, deviceId: string): string {
    return `${organizationId}:${deviceId}`;
  }
}
