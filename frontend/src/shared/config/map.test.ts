import { describe, expect, it } from 'vitest';
import { usableBasemaps, type Basemap } from './map';

const basemap = (id: string, localOnly?: boolean): Basemap => ({
  id,
  name: id,
  tileUrl: `https://tiles.example.test/${id}/{z}/{x}/{y}.png`,
  attribution: id,
  maxZoom: 18,
  maxNativeZoom: 17,
  ...(localOnly === undefined ? {} : { localOnly }),
});

const LIST = [basemap('topo'), basemap('terrain', true), basemap('street', false)];
const ids = (list: Basemap[]) => list.map((b) => b.id);

describe('usableBasemaps', () => {
  it.each(['localhost', 'app.localhost', '127.0.0.1', '[::1]'])('keeps every basemap on %s', (host) => {
    expect(ids(usableBasemaps(LIST, host, []))).toEqual(['topo', 'terrain', 'street']);
  });

  it.each(['treklink-web.vercel.app', '192.168.1.20', 'localhost.example.com'])(
    'drops localOnly basemaps on %s and keeps the order',
    (host) => {
      expect(ids(usableBasemaps(LIST, host, []))).toEqual(['topo', 'street']);
    },
  );

  it('keeps a list of localOnly basemaps rather than drawing no map', () => {
    const only = [basemap('terrain', true)];
    expect(ids(usableBasemaps(only, 'treklink-web.vercel.app', []))).toEqual(['terrain']);
  });
});
