/**
 * Map provider configuration.
 *
 * Provider-agnostic by design (D-012, D-015): nothing here names a vendor in code. Any provider
 * that serves a MapLibre-compatible `style.json` works by changing environment variables alone.
 *
 * LEGAL CONSTRAINT — this is not a preference. Vietnamese law (Nghị định 174/2026/NĐ-CP, Điều 93
 * khoản 3 điểm a, in force 2026-07-01) fines 30–40M VND, and permits forced removal of the
 * application, for publishing a map of Vietnam that fails to fully or correctly depict national
 * sovereignty. OpenStreetMap and other global default tile sources label Hoàng Sa and Trường Sa
 * with foreign toponyms and MUST NOT be used. Default here is Goong Maps, a Vietnamese provider.
 *
 * Changing VITE_MAP_STYLE_URL requires a fresh sovereignty check over ~16.5N 112.0E and
 * ~9.7N 114.0E, with screenshots filed as evidence.
 *
 * Goong issues TWO credentials and they are not interchangeable:
 *   - Map Key  -> style and tile URLs (VITE_MAP_KEY)
 *   - API Key  -> Autocomplete, Direction, Geocoding, Distance Matrix, Place Detail
 * The Map Key is visible in the browser by design; restrict it with an HTTP-referer allowlist and
 * a per-IP rate limit in the provider console.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. See .env.example — the map layer has no ` +
        `hardcoded fallback on purpose, because a silent fallback to a default tile source would ` +
        `be a legal violation (D-012).`,
    );
  }
  return value;
}

function num(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) throw new Error(`Environment variable ${name} is not a number: ${value}`);
  return parsed;
}

const env = import.meta.env;

export interface MapConfig {
  /** Provider identifier, for attribution and diagnostics only. Never branch on this in components. */
  provider: string;
  /** MapLibre-compatible style.json URL, credential already appended. */
  styleUrl: string;
  /** Initial viewport centre as [longitude, latitude] — MapLibre order, not Leaflet's. */
  center: [number, number];
  zoom: number;
  minZoom: number;
  maxZoom: number;
  attribution: string;
}

const mapKey = required('VITE_MAP_KEY', env.VITE_MAP_KEY);

export const mapConfig: MapConfig = {
  provider: env.VITE_MAP_PROVIDER ?? 'goong',
  styleUrl: `${required('VITE_MAP_STYLE_URL', env.VITE_MAP_STYLE_URL)}?api_key=${mapKey}`,
  center: [
    num('VITE_MAP_CENTER_LNG', env.VITE_MAP_CENTER_LNG, 108.5381),
    num('VITE_MAP_CENTER_LAT', env.VITE_MAP_CENTER_LAT, 11.5544),
  ],
  zoom: num('VITE_MAP_ZOOM', env.VITE_MAP_ZOOM, 13),
  minZoom: num('VITE_MAP_MIN_ZOOM', env.VITE_MAP_MIN_ZOOM, 5),
  maxZoom: num('VITE_MAP_MAX_ZOOM', env.VITE_MAP_MAX_ZOOM, 18),
  attribution: env.VITE_MAP_ATTRIBUTION ?? '© Goong Maps',
};
