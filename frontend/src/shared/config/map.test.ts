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

const LIST = [basemap('opentopomap'), basemap('stadia-terrain', true), basemap('esri-topo', false)];
const ids = (list: Basemap[]) => list.map((b) => b.id);

describe('usableBasemaps', () => {
  it.each(['localhost', 'app.localhost', '127.0.0.1', '[::1]'])('keeps every basemap on %s', (host) => {
    expect(ids(usableBasemaps(LIST, host))).toEqual(['opentopomap', 'stadia-terrain', 'esri-topo']);
  });

  it.each(['treklink-web.vercel.app', '192.168.1.20', 'localhost.example.com'])(
    'drops localOnly basemaps on %s and keeps the order',
    (host) => {
      expect(ids(usableBasemaps(LIST, host))).toEqual(['opentopomap', 'esri-topo']);
    },
  );

  it('keeps a list of localOnly basemaps rather than drawing no map', () => {
    const only = [basemap('stadia-terrain', true)];
    expect(ids(usableBasemaps(only, 'treklink-web.vercel.app'))).toEqual(['stadia-terrain']);
  });
});
