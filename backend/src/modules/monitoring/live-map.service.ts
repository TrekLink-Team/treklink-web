import { Injectable, Logger } from '@nestjs/common';
import { ParameterService } from '../platform/parameters/parameter.service';
import { ParameterKey } from '../platform/parameters/parameter-registry';
import { SOVEREIGNTY_OVERLAY, SovereigntyLabel } from './sovereignty-overlay';

// The body of GET /api/map/config (api-design 01).
export interface MapConfigDto {
  provider: string;
  tileUrl: string;
  attribution: string;
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

  // Provider, tiles, attribution and viewport come from the business parameters (FR-CFG-03, D-015);
  // there is no fallback to a default tile source, because a silent default could be a non-compliant
  // basemap. A parameter of the wrong shape fails the request and says which one.
  async config(): Promise<MapConfigDto> {
    const [provider, tileUrl, attribution, viewport, staleAfterSeconds] = await Promise.all([
      this.text('monitoring.mapProvider'),
      this.text('monitoring.mapTileUrl'),
      this.text('monitoring.mapAttribution'),
      this.parameters.get('monitoring.mapDefaultViewport'),
      this.parameters.get('monitoring.deviceStaleSeconds'),
    ]);
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
      tileUrl,
      attribution,
      defaultViewport: { lat, lon, zoom },
      sovereigntyOverlay: SOVEREIGNTY_OVERLAY.map((place) => ({ ...place })),
      staleAfterSeconds,
    };
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
