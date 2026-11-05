import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MAP_CONFIG_KEY, getMapConfig } from '../../shared/config/map';
import { formatCoordinates } from '../../shared/ui/map/coordinates';
import { LiveMapWidget, type MapMarker } from './LiveMapWidget';

// The zoom a single position opens at: a few streets around the point, enough to place it on a trail.
const POSITION_ZOOM = 13;

/**
 * One position on a small map with the coordinates under it: a device's last position (screen 4.2) or
 * a lost unit's last known position (screen 4.4). The shared Leaflet map, so the basemap comes from
 * GET /api/map/config and the sovereignty overlay is drawn as on every map (D-031). The marker reads as
 * fresh while `seenAt` is within the configured stale time, and as stale otherwise.
 */
export const PositionMap: React.FC<{
  position: { lat: number; lon: number } | null;
  /** The marker's title, such as the asset tag. */
  label: string;
  /** When the position was reported; without it the marker reads as stale. */
  seenAt?: string | null;
  /** The text in place of the map when there is no position. */
  emptyText?: string;
}> = ({ position, label, seenAt = null, emptyText = 'Position unavailable' }) => {
  const config = useQuery({ queryKey: MAP_CONFIG_KEY, queryFn: getMapConfig, retry: false, staleTime: Infinity });
  // The time the page opened; the marker's freshness is judged against it.
  const [openedAt] = useState(() => Date.now());
  if (!position) return <p className="text-body text-ink">{emptyText}</p>;

  const staleAfterMs = (config.data?.staleAfterSeconds ?? 0) * 1000;
  const fresh = seenAt !== null && staleAfterMs > 0 && openedAt - new Date(seenAt).getTime() <= staleAfterMs;
  const coordinates = formatCoordinates(position);
  const marker: MapMarker = {
    id: 'position',
    position: [position.lat, position.lon],
    title: label,
    subtitle: coordinates,
    status: fresh ? 'ok' : 'stale',
    name: `${label}, ${fresh ? 'last position' : 'last known position'}, ${coordinates}`,
  };

  return (
    <figure className="flex flex-col gap-2">
      <LiveMapWidget
        markers={[marker]}
        view={{ center: marker.position, zoom: POSITION_ZOOM }}
        compact
        className="h-48 shadow-none sm:h-56"
      />
      <figcaption className="font-mono text-body-sm text-ink">{coordinates}</figcaption>
    </figure>
  );
};
