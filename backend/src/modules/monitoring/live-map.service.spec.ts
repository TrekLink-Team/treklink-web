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
    service = new LiveMapService(parameters as unknown as ParameterService);
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
        { label: 'Quần đảo Hoàng Sa (Việt Nam)', lat: 16.5, lon: 112.0 },
        { label: 'Quần đảo Trường Sa (Việt Nam)', lat: 10.0, lon: 114.0 },
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

  it.each([
    ['monitoring.mapProvider', 42],
    ['monitoring.mapProvider', 'cyclosm'],
    ['monitoring.mapBasemaps', []],
    ['monitoring.mapBasemaps', null],
    ['monitoring.mapBasemaps', [TOPO, TOPO]],
    ['monitoring.mapBasemaps', [{ ...TOPO, tileUrl: '' }]],
    ['monitoring.mapBasemaps', [{ ...TOPO, maxNativeZoom: 19 }]],
    ['monitoring.mapBasemaps', [{ ...TOPO, maxZoom: 18.5 }]],
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
