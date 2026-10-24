import { apiClient } from '../api/apiClient';

// GET /api/map/config (monitoring api-design 01). Tiles, attribution, viewport and the overlay labels
// all come from the server; nothing here names a provider (D-031).
export interface MapConfig {
  provider: string;
  tileUrl: string;
  attribution: string;
  defaultViewport: { lat: number; lon: number; zoom: number };
  sovereigntyOverlay: { label: string; lat: number; lon: number }[];
  staleAfterSeconds: number;
}

export const MAP_CONFIG_KEY = ['map', 'config'] as const;

export const getMapConfig = (): Promise<MapConfig> => apiClient<MapConfig>('/map/config');
