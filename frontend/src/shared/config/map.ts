import { apiClient } from '../api/apiClient';

// One basemap of the layer control (D-072). Above maxNativeZoom Leaflet enlarges the deepest tiles.
// `localOnly`: the provider serves keyless tiles to a loopback host only (Stadia answers 401 elsewhere).
export interface Basemap {
  id: string;
  name: string;
  tileUrl: string;
  attribution: string;
  maxZoom: number;
  maxNativeZoom: number;
  localOnly?: boolean;
}

// Basemaps kept out of the picker until their own sea labels are masked (task W22, panel walk 2026-11-04).
// OpenTopoMap and Stadia print "South China Sea" in open water at zoom 5 to 7 and "北部湾" on the Gulf of
// Tonkin, outside the two archipelago masks of the sovereignty overlay (D-031, D-085). The entries stay
// in `monitoring.mapBasemaps` on the server; delete an id here to offer that basemap again.
export const HIDDEN_BASEMAP_IDS: readonly string[] = ['opentopomap', 'stadia-terrain'];

const isLoopbackHost = (hostname: string): boolean =>
  hostname === 'localhost' ||
  hostname.endsWith('.localhost') ||
  hostname === '[::1]' ||
  hostname === '::1' ||
  /^127(\.\d{1,3}){3}$/.test(hostname);

// The basemaps this page can draw, in the server's order: a hidden entry is always dropped, and a
// localOnly entry is dropped on a host that is not loopback. Each filter is skipped when it would leave
// no basemap at all, so the page never draws an empty map (screen 9.1, monitoring api-design 01).
export const usableBasemaps = (
  basemaps: readonly Basemap[],
  hostname: string = window.location.hostname,
  hidden: readonly string[] = HIDDEN_BASEMAP_IDS,
): Basemap[] => {
  const shown = basemaps.filter((basemap) => !hidden.includes(basemap.id));
  const offered = shown.length > 0 ? shown : [...basemaps];
  if (isLoopbackHost(hostname)) return offered;
  const reachable = offered.filter((basemap) => !basemap.localOnly);
  return reachable.length > 0 ? reachable : offered;
};

// The basemap the map opens on: the configured default when the picker still offers it, otherwise the
// first one offered. A default that names a hidden or unreachable basemap falls back without an error.
export const initialBasemap = (basemaps: readonly Basemap[], preferredId: string): Basemap =>
  basemaps.find((basemap) => basemap.id === preferredId) ?? basemaps[0];

// GET /api/map/config (monitoring api-design 01). Basemaps, attribution, viewport and the overlay labels
// all come from the server; nothing here defines a provider (D-031, D-072). `provider` is the id of the
// default basemap; `tileUrl` and `attribution` repeat it.
export interface MapConfig {
  provider: string;
  tileUrl: string;
  attribution: string;
  basemaps: Basemap[];
  defaultViewport: { lat: number; lon: number; zoom: number };
  /** `mask`: [lat, lon] polygon the client fills opaque under the label, hiding the basemap's own labels (D-085). */
  sovereigntyOverlay: { label: string; lat: number; lon: number; mask: [number, number][] }[];
  staleAfterSeconds: number;
}

export const MAP_CONFIG_KEY = ['map', 'config'] as const;

export const getMapConfig = (): Promise<MapConfig> => apiClient<MapConfig>('/map/config');
