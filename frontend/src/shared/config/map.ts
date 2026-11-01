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

const isLoopbackHost = (hostname: string): boolean =>
  hostname === 'localhost' ||
  hostname.endsWith('.localhost') ||
  hostname === '[::1]' ||
  hostname === '::1' ||
  /^127(\.\d{1,3}){3}$/.test(hostname);

// The basemaps this page can draw: a localOnly entry is dropped on a host that is not loopback, unless
// that would leave no basemap at all (screen 9.1, monitoring api-design 01).
export const usableBasemaps = (
  basemaps: readonly Basemap[],
  hostname: string = window.location.hostname,
): Basemap[] => {
  if (isLoopbackHost(hostname)) return [...basemaps];
  const reachable = basemaps.filter((basemap) => !basemap.localOnly);
  return reachable.length > 0 ? reachable : [...basemaps];
};

// GET /api/map/config (monitoring api-design 01). Basemaps, attribution, viewport and the overlay labels
// all come from the server; nothing here names a provider (D-031, D-072). `provider` is the id of the
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
