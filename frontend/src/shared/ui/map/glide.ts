import L from 'leaflet';

// Live markers glide from one reading to the next instead of jumping (dry run defect 10). The glide is
// short against the 5 s reading interval, so a marker is at rest before the next reading arrives.
export const GLIDE_MS = 1000;
// Beyond this a glide reads as travel the device did not make; the marker moves at once.
export const GLIDE_MAX_METERS = 2000;
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** Fast start, gentle stop. */
export const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia(REDUCED_MOTION_QUERY).matches;

export interface MarkerGlider {
  /**
   * Moves the marker to `to`. It glides when the move is short and stays on the visible map, and jumps
   * when it is long, leaves the view, or the user prefers reduced motion. A new target mid-glide
   * restarts from where the marker is now. A bound popup follows the marker.
   */
  moveTo(marker: L.Marker, to: L.LatLngExpression): void;
  /** Stops the marker's glide where it is. */
  cancel(marker: L.Marker): void;
  /** Stops every glide, for unmount. */
  cancelAll(): void;
}

interface Glide {
  frame: number;
  target: L.LatLng;
}

export const createMarkerGlider = (
  map: L.Map,
  { durationMs = GLIDE_MS, maxMeters = GLIDE_MAX_METERS } = {},
): MarkerGlider => {
  const glides = new Map<L.Marker, Glide>();

  const cancel = (marker: L.Marker) => {
    const glide = glides.get(marker);
    if (!glide) return;
    cancelAnimationFrame(glide.frame);
    glides.delete(marker);
  };

  const moveTo = (marker: L.Marker, to: L.LatLngExpression) => {
    const target = L.latLng(to);
    // The same reading again (a refresh of another field) keeps the glide in flight unchanged.
    if (glides.get(marker)?.target.equals(target)) return;
    cancel(marker);
    const from = marker.getLatLng();
    if (from.equals(target)) return;
    const view = map.getBounds();
    if (
      prefersReducedMotion() ||
      from.distanceTo(target) > maxMeters ||
      !view.contains(from) ||
      !view.contains(target)
    ) {
      marker.setLatLng(target);
      return;
    }
    let start: number | null = null;
    const step = (now: number) => {
      start ??= now;
      const t = Math.min(1, Math.max(0, (now - start) / durationMs));
      if (t >= 1) {
        glides.delete(marker);
        marker.setLatLng(target);
        return;
      }
      const k = easeOutCubic(t);
      marker.setLatLng([
        from.lat + (target.lat - from.lat) * k,
        from.lng + (target.lng - from.lng) * k,
      ]);
      glides.set(marker, { frame: requestAnimationFrame(step), target });
    };
    glides.set(marker, { frame: requestAnimationFrame(step), target });
  };

  const cancelAll = () => {
    for (const marker of [...glides.keys()]) cancel(marker);
  };

  return { moveTo, cancel, cancelAll };
};
