import { Logger } from '@nestjs/common';
import { ParameterService } from '../platform/parameters/parameter.service';
import { LiveMapService } from './live-map.service';

const TOPO = {
  id: 'opentopomap',
  name: 'Topographic (OpenTopoMap)',
  tileUrl: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
  attribution: 'Map data © OpenStreetMap contributors, SRTM; style © OpenTopoMap (CC-BY-SA)',
  maxZoom: 18,
  maxNativeZoom: 17,
};
const OSM = {
  id: 'openstreetmap',
  name: 'OpenStreetMap',
  tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '© OpenStreetMap contributors',
  maxZoom: 19,
  maxNativeZoom: 19,
};

const SEEDED: Record<string, unknown> = {
  'monitoring.mapProvider': 'opentopomap',
  'monitoring.mapBasemaps': [TOPO, OSM],
  'monitoring.mapDefaultViewport': { lat: 11.56, lon: 108.54, zoom: 12 },
  'monitoring.deviceStaleSeconds': 300,
};

describe('LiveMapService.config', () => {
  let values: Record<string, unknown>;
  let service: LiveMapService;
  let logged: jest.SpyInstance;

  beforeEach(() => {
    values = { ...SEEDED };
    const parameters = { get: jest.fn((key: string) => Promise.resolve(values[key])) };
    service = new LiveMapService(
      parameters as unknown as ParameterService,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('returns the response of api-design 01 from the seeded parameters', async () => {
    await expect(service.config()).resolves.toEqual({
      provider: 'opentopomap',
      tileUrl: TOPO.tileUrl,
      attribution: TOPO.attribution,
      basemaps: [TOPO, OSM],
      defaultViewport: { lat: 11.56, lon: 108.54, zoom: 12 },
      sovereigntyOverlay: [
        expect.objectContaining({ label: 'Quần đảo Hoàng Sa (Việt Nam)', lat: 16.5, lon: 112.0 }),
        expect.objectContaining({ label: 'Quần đảo Trường Sa (Việt Nam)', lat: 10.0, lon: 114.0 }),
      ],
      staleAfterSeconds: 300,
    });
  });

  it('carries the sovereignty overlay over both archipelagos, whatever the parameters say', async () => {
    values['monitoring.mapBasemaps'] = [{ ...OSM, id: 'goong' }];
    values['monitoring.mapProvider'] = 'goong';
    const { sovereigntyOverlay } = await service.config();
    expect(sovereigntyOverlay.map((place) => place.label)).toEqual([
      'Quần đảo Hoàng Sa (Việt Nam)',
      'Quần đảo Trường Sa (Việt Nam)',
    ]);
  });

  it('hands out a copy of the overlay, so a caller cannot change the constant', async () => {
    const first = await service.config();
    first.sovereigntyOverlay[0].label = 'changed';
    const second = await service.config();
    expect(second.sovereigntyOverlay[0].label).toBe('Quần đảo Hoàng Sa (Việt Nam)');
  });

  it('hands out a copy of each mask, so a caller cannot move the constant area', async () => {
    const first = await service.config();
    first.sovereigntyOverlay[0].mask[0][0] = 0;
    const second = await service.config();
    expect(second.sovereigntyOverlay[0].mask[0][0]).toBe(17.7);
  });

  // Ray casting over [lat, lon] pairs: the label must sit on its own mask (D-085).
  const inside = ([lat, lon]: [number, number], polygon: [number, number][]): boolean => {
    let hit = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [latI, lonI] = polygon[i];
      const [latJ, lonJ] = polygon[j];
      const crosses = latI > lat !== latJ > lat;
      if (crosses && lon < ((lonJ - lonI) * (lat - latI)) / (latJ - latI) + lonI) hit = !hit;
    }
    return hit;
  };

  it('masks the basemap under each label, the PRC label anchors included (D-085)', async () => {
    const { sovereigntyOverlay } = await service.config();
    const [paracels, spratlys] = sovereigntyOverlay;
    for (const place of sovereigntyOverlay) {
      expect(place.mask.length).toBeGreaterThanOrEqual(3);
      expect(inside([place.lat, place.lon], place.mask)).toBe(true);
    }
    // Where OpenTopoMap anchors "西沙区" (Woody Island) and "南沙区" (Fiery Cross Reef).
    expect(inside([16.834, 112.338], paracels.mask)).toBe(true);
    expect(inside([9.55, 112.89], spratlys.mask)).toBe(true);
    // The mainland coast stays visible.
    expect(inside([16.05, 108.2], paracels.mask)).toBe(false);
    expect(inside([10.8, 106.7], spratlys.mask)).toBe(false);
  });

  it('follows an Admin edit of the default basemap and the list (D-072)', async () => {
    const vn = {
      ...OSM,
      id: 'example-vn',
      tileUrl: 'https://tiles.example.vn/{z}/{x}/{y}.png',
      attribution: '© Example Vietnam',
    };
    values['monitoring.mapBasemaps'] = [TOPO, vn];
    values['monitoring.mapProvider'] = 'example-vn';
    const config = await service.config();
    expect(config.provider).toBe('example-vn');
    expect(config.tileUrl).toBe('https://tiles.example.vn/{z}/{x}/{y}.png');
    expect(config.attribution).toBe('© Example Vietnam');
    expect(config.basemaps.map((b) => b.id)).toEqual(['opentopomap', 'example-vn']);
  });

  it('passes localOnly through only when it is true', async () => {
    const stadia = { ...OSM, id: 'stadia-terrain', localOnly: true };
    values['monitoring.mapBasemaps'] = [{ ...TOPO, localOnly: false }, stadia];
    const config = await service.config();
    expect(config.basemaps[0]).not.toHaveProperty('localOnly');
    expect(config.basemaps[1]).toMatchObject({ id: 'stadia-terrain', localOnly: true });
  });

  it.each([
    ['monitoring.mapProvider', 42],
    ['monitoring.mapProvider', 'cyclosm'],
    ['monitoring.mapBasemaps', []],
    ['monitoring.mapBasemaps', null],
    ['monitoring.mapBasemaps', [TOPO, TOPO]],
    ['monitoring.mapBasemaps', [{ ...TOPO, tileUrl: '' }]],
    ['monitoring.mapBasemaps', [{ ...TOPO, maxNativeZoom: 19 }]],
    ['monitoring.mapBasemaps', [{ ...TOPO, maxZoom: 18.5 }]],
    ['monitoring.mapBasemaps', [{ ...TOPO, localOnly: 'yes' }]],
    ['monitoring.mapDefaultViewport', { lat: 'north', lon: 108, zoom: 12 }],
    ['monitoring.mapDefaultViewport', [11.56, 108.54, 12]],
    ['monitoring.mapDefaultViewport', null],
    ['monitoring.mapDefaultViewport', { lat: 11.56, lon: 108.54 }],
    ['monitoring.deviceStaleSeconds', 'soon'],
  ])('refuses %s set to %p and names the parameter, with no silent default', async (key, bad) => {
    values[key] = bad;
    await expect(service.config()).rejects.toThrow(`Map parameter ${key} is malformed.`);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining(key));
  });
});
