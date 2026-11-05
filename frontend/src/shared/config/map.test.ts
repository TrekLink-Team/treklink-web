import { describe, expect, it } from 'vitest';
import { HIDDEN_BASEMAP_IDS, initialBasemap, usableBasemaps, type Basemap } from './map';

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
  it.each(['localhost', 'app.localhost', '127.0.0.1', '[::1]'])(
    'keeps every basemap on %s',
    (host) => {
      expect(ids(usableBasemaps(LIST, host, []))).toEqual(['topo', 'terrain', 'street']);
    },
  );

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

// The list on the demo seed and the Vercel staging (migrations 20261027090000 to 20261101130000).
const SERVER_LIST = [basemap('opentopomap'), basemap('stadia-terrain', true), basemap('esri-topo')];

describe('the basemap picker list (task W22)', () => {
  it('hides OpenTopoMap and Stadia, whose tiles print foreign names for Vietnamese waters', () => {
    expect(HIDDEN_BASEMAP_IDS).toEqual(['opentopomap', 'stadia-terrain']);
  });

  it.each(['treklink-web.vercel.app', 'localhost'])(
    'offers only Esri from the server list on %s',
    (host) => {
      expect(ids(usableBasemaps(SERVER_LIST, host))).toEqual(['esri-topo']);
    },
  );

  it('keeps every other basemap, in the server order', () => {
    const list = [basemap('esri-topo'), basemap('opentopomap'), basemap('openstreetmap')];
    expect(ids(usableBasemaps(list, 'treklink-web.vercel.app'))).toEqual([
      'esri-topo',
      'openstreetmap',
    ]);
  });

  it('keeps a list of hidden basemaps rather than drawing no map', () => {
    const only = [basemap('opentopomap')];
    expect(ids(usableBasemaps(only, 'treklink-web.vercel.app'))).toEqual(['opentopomap']);
  });
});

describe('initialBasemap', () => {
  const offered = usableBasemaps(SERVER_LIST, 'treklink-web.vercel.app');

  it('opens on the configured default when the picker offers it', () => {
    const list = [basemap('street'), basemap('topo')];
    expect(initialBasemap(list, 'topo').id).toBe('topo');
  });

  it.each(['opentopomap', 'stadia-terrain', 'no-such-basemap'])(
    'falls back to the first offered basemap when the default is %s',
    (preferred) => {
      expect(() => initialBasemap(offered, preferred)).not.toThrow();
      expect(initialBasemap(offered, preferred).id).toBe('esri-topo');
    },
  );
});
