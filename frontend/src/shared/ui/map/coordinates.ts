/** A position as a person reads it under a map: latitude, longitude, five decimals (about a metre). */
export const formatCoordinates = (position: { lat: number; lon: number }): string =>
  `${position.lat.toFixed(5)}, ${position.lon.toFixed(5)}`;
