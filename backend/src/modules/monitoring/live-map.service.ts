import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { subject } from '@casl/ability';
import { IncidentState } from '@prisma/client';
import { Caller, type PolicyAbility } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { DevicesService } from '../devices';
import { IncidentsQueryService, type OpenIncidentRef } from '../incidents';
import { ParameterService } from '../platform/parameters/parameter.service';
import { ParameterKey } from '../platform/parameters/parameter-registry';
import { ContractsService } from '../rentals';
import { SOVEREIGNTY_OVERLAY, SovereigntyLabel } from './sovereignty-overlay';
import { StreamRepository } from './stream.repository';

// One basemap the user can switch to (D-072). Above maxNativeZoom the client enlarges the deepest tiles
// instead of requesting tiles the provider does not draw.
export interface BasemapDto {
  id: string;
  name: string;
  tileUrl: string;
  attribution: string;
  maxZoom: number;
  maxNativeZoom: number;
}

// The body of GET /api/map/config (api-design 01). `provider`, `tileUrl` and `attribution` describe the
// default basemap, kept for clients that draw one layer.
export interface MapConfigDto {
  provider: string;
  tileUrl: string;
  attribution: string;
  basemaps: BasemapDto[];
  defaultViewport: { lat: number; lon: number; zoom: number };
  sovereigntyOverlay: SovereigntyLabel[];
  staleAfterSeconds: number;
}

// One device of GET /api/map/snapshot (api-design 02). `position.at` is the device's last-seen time:
// the projection keeps no separate fix time yet, and a position never arrives without a reading.
export interface SnapshotDeviceDto {
  id: string;
  assetTag: string;
  hardwareVariant: string;
  holder: { name: string } | null;
  position: { lat: number; lon: number; at: string } | null;
  batteryPct: number | null;
  lastSeenAt: string | null;
  stale: boolean;
  openIncident: { id: string; code: string; state: IncidentState } | null;
  contractCode: string;
  organizationId: string;
}

export interface SnapshotFieldStationDto {
  id: string;
  name: string;
  lastSyncAt: string | null;
  stale: boolean;
}

// The body of GET /api/map/snapshot (api-design 02).
export interface MapSnapshotDto {
  cursor: number;
  devices: SnapshotDeviceDto[];
  fieldStations: SnapshotFieldStationDto[];
}

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

// An organization id no row carries. Only the unconditioned `liveMap.read` rule (TrekLink Staff and
// Admin) matches it; `liveMap.read.own` matches the caller's own organization only.
const ANY_ORGANIZATION = '*any organization*';

const forbidden = () =>
  new DomainException(HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN, 'You do not have access to this.');

// The live map's read model (design §4, task 3.1): the map configuration and the snapshot.
@Injectable()
export class LiveMapService {
  private readonly logger = new Logger(LiveMapService.name);

  constructor(
    private readonly parameters: ParameterService,
    private readonly contracts: ContractsService,
    private readonly devices: DevicesService,
    private readonly incidents: IncidentsQueryService,
    private readonly stream: StreamRepository,
  ) {}

  // The state the map draws before it applies stream entries (api-design 02, FR-MON-02, FR-MON-03,
  // FR-AUTH-11). The scope comes from the caller's ability: TrekLink staff see the fleet or the one
  // organization they ask for, a member sees their own organization and is refused another. The
  // cursor is read first, so an entry committed while the rest is read is replayed, never lost; the
  // client drops entries at or below the cursor. Field Stations are not modelled yet, so the list is
  // empty until organizations exports their health read.
  async snapshot(
    query: { organizationId?: string },
    caller: Caller,
    ability: PolicyAbility,
    now: Date = new Date(),
  ): Promise<MapSnapshotDto> {
    const organizationId = this.scopeOf(query, caller, ability);
    const cursor = await this.stream.maxSeq();
    const [visible, staleSeconds] = await Promise.all([
      this.contracts.visibleDevices({ organizationId }),
      this.parameters.get('monitoring.deviceStaleSeconds'),
    ]);
    if (!isNumber(staleSeconds)) this.refuse('monitoring.deviceStaleSeconds', 'a number');
    const ids = visible.map((device) => device.deviceId);
    const [projections, incidents] = await Promise.all([
      this.devices.projections(ids),
      this.incidents.openByDevices(ids),
    ]);
    const rental = new Map(visible.map((device) => [device.deviceId, device]));
    const staleBefore = now.getTime() - staleSeconds * 1000;

    const devices = projections.flatMap((device): SnapshotDeviceDto[] => {
      const rented = rental.get(device.id);
      if (!rented) return [];
      const lastSeenAt = device.lastSeenAt?.toISOString() ?? null;
      const plotted =
        device.lastLatitude !== null && device.lastLongitude !== null && lastSeenAt !== null;
      return [
        {
          id: device.id,
          assetTag: device.assetTag,
          hardwareVariant: device.variantCode,
          holder: rented.holder,
          position: plotted
            ? {
                lat: device.lastLatitude as number,
                lon: device.lastLongitude as number,
                at: lastSeenAt,
              }
            : null,
          batteryPct: device.batteryPct,
          lastSeenAt,
          stale: device.lastSeenAt !== null && device.lastSeenAt.getTime() < staleBefore,
          openIncident: this.incidentOf(incidents.get(device.id), organizationId),
          contractCode: rented.contractCode,
          organizationId: rented.organizationId,
        },
      ];
    });
    return { cursor, devices, fieldStations: [] };
  }

  // An incident routed to another organization is never shown on an organization's map (incidents
  // REQ-STA-01); the fleet map shows every one.
  private incidentOf(
    incident: OpenIncidentRef | undefined,
    organizationId: string | null,
  ): SnapshotDeviceDto['openIncident'] {
    if (!incident) return null;
    if (organizationId !== null && incident.organizationId !== organizationId) return null;
    return { id: incident.id, code: incident.code, state: incident.state };
  }

  // The organization the caller's map covers, null for the whole fleet.
  private scopeOf(
    query: { organizationId?: string },
    caller: Caller,
    ability: PolicyAbility,
  ): string | null {
    if (ability.can('read', subject('LiveMap', { organizationId: ANY_ORGANIZATION })))
      return query.organizationId ?? null;
    const own = caller.organizationId;
    if (own === null || !ability.can('read', subject('LiveMap', { organizationId: own })))
      throw forbidden();
    if (query.organizationId !== undefined && query.organizationId !== own) throw forbidden();
    return own;
  }

  // Basemaps, the default one and the viewport come from the business parameters (FR-CFG-03, D-015,
  // D-072); there is no fallback to a default tile source, because a silent default could be a
  // non-compliant basemap. A parameter of the wrong shape fails the request and says which one.
  async config(): Promise<MapConfigDto> {
    const [provider, rawBasemaps, viewport, staleAfterSeconds] = await Promise.all([
      this.text('monitoring.mapProvider'),
      this.parameters.get('monitoring.mapBasemaps'),
      this.parameters.get('monitoring.mapDefaultViewport'),
      this.parameters.get('monitoring.deviceStaleSeconds'),
    ]);
    const basemaps = this.basemaps(rawBasemaps);
    const selected = basemaps.find((basemap) => basemap.id === provider);
    if (!selected)
      this.refuse('monitoring.mapProvider', 'the id of an entry in monitoring.mapBasemaps');
    if (
      typeof viewport !== 'object' ||
      viewport === null ||
      Array.isArray(viewport) ||
      !isNumber(viewport.lat) ||
      !isNumber(viewport.lon) ||
      !isNumber(viewport.zoom)
    ) {
      this.refuse('monitoring.mapDefaultViewport', 'an object with numeric lat, lon and zoom');
    }
    if (!isNumber(staleAfterSeconds)) this.refuse('monitoring.deviceStaleSeconds', 'a number');
    const { lat, lon, zoom } = viewport as { lat: number; lon: number; zoom: number };
    return {
      provider,
      tileUrl: selected.tileUrl,
      attribution: selected.attribution,
      basemaps,
      defaultViewport: { lat, lon, zoom },
      sovereigntyOverlay: SOVEREIGNTY_OVERLAY.map((place) => ({ ...place })),
      staleAfterSeconds,
    };
  }

  // A non-empty list of entries with unique ids, non-empty text fields and whole zoom levels where
  // 1 <= maxNativeZoom <= maxZoom <= 22.
  private basemaps(value: unknown): BasemapDto[] {
    const expected =
      'a non-empty list of basemaps with unique ids, text fields and zoom levels 1 to 22';
    if (!Array.isArray(value) || value.length === 0)
      this.refuse('monitoring.mapBasemaps', expected);
    const seen = new Set<string>();
    return (value as unknown[]).map((entry) => {
      const e = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<
        string,
        unknown
      >;
      const texts = ['id', 'name', 'tileUrl', 'attribution'].every(
        (k) => typeof e[k] === 'string' && e[k] !== '',
      );
      const zoom = (k: string) =>
        Number.isInteger(e[k]) && (e[k] as number) >= 1 && (e[k] as number) <= 22;
      if (
        !texts ||
        !zoom('maxZoom') ||
        !zoom('maxNativeZoom') ||
        (e.maxNativeZoom as number) > (e.maxZoom as number) ||
        seen.has(e.id as string)
      ) {
        this.refuse('monitoring.mapBasemaps', expected);
      }
      seen.add(e.id as string);
      return {
        id: e.id as string,
        name: e.name as string,
        tileUrl: e.tileUrl as string,
        attribution: e.attribution as string,
        maxZoom: e.maxZoom as number,
        maxNativeZoom: e.maxNativeZoom as number,
      };
    });
  }

  private async text(key: ParameterKey): Promise<string> {
    const value = await this.parameters.get(key);
    if (typeof value !== 'string' || value === '') this.refuse(key, 'a non-empty string');
    return value;
  }

  private refuse(key: string, expected: string): never {
    this.logger.error(`Map parameter ${key} must be ${expected}.`);
    throw new Error(`Map parameter ${key} is malformed.`);
  }
}
