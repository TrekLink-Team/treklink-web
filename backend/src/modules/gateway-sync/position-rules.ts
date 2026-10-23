// Position rules owned by `monitoring` parameters and applied at ingestion (task 2.3, FR-MON-04).

export interface PositionBounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface LatLon {
  latitude: number;
  longitude: number;
}

const isBounds = (value: unknown): value is PositionBounds =>
  typeof value === 'object' &&
  value !== null &&
  ['minLat', 'maxLat', 'minLon', 'maxLon'].every(
    (key) => typeof (value as Record<string, unknown>)[key] === 'number',
  );

export const toBounds = (value: unknown): PositionBounds => {
  if (!isBounds(value))
    throw new Error('monitoring.positionBounds is not { minLat, maxLat, minLon, maxLon }');
  return value;
};

// WGS-84 range and the configured box (INVALID_POSITION otherwise).
export const isValidPosition = ({ latitude, longitude }: LatLon, bounds: PositionBounds): boolean =>
  Number.isFinite(latitude) &&
  Number.isFinite(longitude) &&
  latitude >= -90 &&
  latitude <= 90 &&
  longitude >= -180 &&
  longitude <= 180 &&
  latitude >= bounds.minLat &&
  latitude <= bounds.maxLat &&
  longitude >= bounds.minLon &&
  longitude <= bounds.maxLon;

const EARTH_RADIUS_KM = 6371.0088;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

export const distanceKm = (a: LatLon, b: LatLon): number => {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
};

// True when the move from the last plotted position implies more than the maximum speed. A reading that
// is not later than the last one has no speed to judge and passes; the projection discards it as older.
export const isImplausibleMove = (
  from: LatLon & { at: Date },
  to: LatLon & { at: Date },
  maxSpeedKmh: number,
): boolean => {
  const hours = (to.at.getTime() - from.at.getTime()) / 3_600_000;
  if (hours <= 0) return false;
  return distanceKm(from, to) / hours > maxSpeedKmh;
};
