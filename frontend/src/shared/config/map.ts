import { apiClient } from '../api/apiClient';

// One basemap of the layer control (D-072). Above maxNativeZoom Leaflet enlarges the deepest tiles.
export interface Basemap {
  id: string;
  name: string;
  tileUrl: string;
  attribution: string;
  maxZoom: number;
  maxNativeZoom: number;
}

// GET /api/map/config (monitoring api-design 01). Basemaps, attribution, viewport and the overlay labels
// all come from the server; nothing here names a provider (D-031, D-072). `provider` is the id of the
// default basemap; `tileUrl` and `attribution` repeat it.
export interface MapConfig {
  provider: string;
  tileUrl: string;
  attribution: string;
  basemaps: Basemap[];
  defaultViewport: { lat: number; lon: number; zoom: number };
  sovereigntyOverlay: { label: string; lat: number; lon: number }[];
  staleAfterSeconds: number;
}

export const MAP_CONFIG_KEY = ['map', 'config'] as const;

export const getMapConfig = (): Promise<MapConfig> => apiClient<MapConfig>('/map/config');
