import { Injectable, Logger } from '@nestjs/common';
import { ParameterService } from '../platform/parameters/parameter.service';
import { ParameterKey } from '../platform/parameters/parameter-registry';
import { SOVEREIGNTY_OVERLAY, SovereigntyLabel } from './sovereignty-overlay';

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

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

// The live map's read model (design §4). Task 3.1 so far: the map configuration. The snapshot waits
// for the reads of `rentals`, `devices` and `incidents` that it composes.
@Injectable()
export class LiveMapService {
  private readonly logger = new Logger(LiveMapService.name);

  constructor(private readonly parameters: ParameterService) {}

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
