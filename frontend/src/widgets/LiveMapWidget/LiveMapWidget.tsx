import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MAP_CONFIG_KEY, getMapConfig, type MapConfig } from '../../shared/config/map';

export interface MapMarker {
  id: string;
  /** [latitude, longitude], Leaflet order. */
  position: [number, number];
  title: string;
  subtitle?: string;
  /** Drives marker colour; keep in step with device/incident status vocabularies. */
  status?: 'ok' | 'warning' | 'stale' | 'incident';
}

const STATUS_COLOR: Record<NonNullable<MapMarker['status']>, string> = {
  ok: '#2563eb',
  warning: '#f59e0b',
  stale: '#94a3b8',
  incident: '#dc2626',
};

// MSG33: the tile area is replaced; lists elsewhere on the page stay live (FR-MON-09).
const MSG33 = 'The map is unavailable. Device and incident lists are still live.';

// Above markers (600) and below popups (700), so a label is never hidden by a device (BR-30).
const OVERLAY_PANE = 'sovereignty';
const OVERLAY_Z_INDEX = '650';

const textOf = (marker: MapMarker): string =>
  marker.subtitle ? `${marker.title}, ${marker.subtitle}` : marker.title;

const overlayIcon = (label: string): L.DivIcon => {
  const element = document.createElement('div');
  element.className =
    '-translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded bg-white/90 px-2 py-0.5 text-xs font-semibold text-red-700 shadow';
  element.textContent = label;
  return L.divIcon({ html: element, className: '', iconSize: [0, 0] });
};

const markerIcon = (marker: MapMarker): L.DivIcon => {
  const element = document.createElement('div');
  element.className = 'h-3 w-3 rounded-full border-2 border-white shadow';
  element.style.backgroundColor = STATUS_COLOR[marker.status ?? 'ok'];
  element.setAttribute('role', 'img');
  element.setAttribute('aria-label', textOf(marker));
  return L.divIcon({ html: element, className: '', iconSize: [12, 12] });
};

const popupContent = (marker: MapMarker): HTMLElement => {
  const element = document.createElement('div');
  const title = document.createElement('p');
  title.className = 'font-semibold text-sm';
  title.textContent = marker.title;
  element.append(title);
  if (marker.subtitle) {
    const subtitle = document.createElement('p');
    subtitle.className = 'text-xs text-slate-500';
    subtitle.textContent = marker.subtitle;
    element.append(subtitle);
  }
  return element;
};

const Unavailable: React.FC<{ overlay: MapConfig['sovereigntyOverlay'] }> = ({ overlay }) => (
  <div
    role="alert"
    className="absolute inset-0 z-[800] flex flex-col items-center justify-center gap-1 bg-slate-50 p-4 text-center"
  >
    <p className="text-sm font-semibold text-slate-700">{MSG33}</p>
    {overlay.length > 0 && (
      <ul className="text-xs text-slate-600">
        {overlay.map((place) => (
          <li key={place.label}>{place.label}</li>
        ))}
      </ul>
    )}
  </div>
);

const LeafletMap: React.FC<{ config: MapConfig; markers: MapMarker[] }> = ({ config, markers }) => {
  const [map, setMap] = useState<L.Map | null>(null);
  const [tilesFailed, setTilesFailed] = useState(false);
  const markerRefs = useRef<Map<string, L.Marker>>(new Map());

  // The map is created in a callback ref: creation needs the DOM node, and reporting a tile failure
  // sets state, which an effect body should not do synchronously.
  const containerRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return;
      const { lat, lon, zoom } = config.defaultViewport;
      const instance = L.map(node).setView([lat, lon], zoom);

      const tiles = L.tileLayer(config.tileUrl, { attribution: config.attribution });
      tiles.on('tileerror', () => setTilesFailed(true));
      tiles.on('tileload', () => setTilesFailed(false));
      tiles.addTo(instance);

      // Always on, never in a layer control, never removed by the user (REQ-UBI-06).
      const pane = instance.createPane(OVERLAY_PANE);
      pane.style.zIndex = OVERLAY_Z_INDEX;
      pane.style.pointerEvents = 'none';
      const overlay = L.layerGroup().addTo(instance);
      for (const place of config.sovereigntyOverlay) {
        L.marker([place.lat, place.lon], {
          icon: overlayIcon(place.label),
          pane: OVERLAY_PANE,
          interactive: false,
          keyboard: false,
        }).addTo(overlay);
      }
      setMap(instance);
    },
    [config],
  );

  useEffect(() => {
    if (!map) return;
    const tracked = markerRefs.current;
    return () => {
      tracked.clear();
      map.remove();
    };
  }, [map]);

  // Reconcile markers against the current set: update in place, add new, remove departed.
  useEffect(() => {
    if (!map) return;
    const seen = new Set<string>();

    for (const m of markers) {
      seen.add(m.id);
      const existing = markerRefs.current.get(m.id);
      if (existing) {
        existing.setLatLng(m.position);
        continue;
      }
      const marker = L.marker(m.position, { icon: markerIcon(m), title: textOf(m), alt: textOf(m) })
        .bindPopup(popupContent(m), { offset: [0, -4] })
        .addTo(map);
      markerRefs.current.set(m.id, marker);
    }

    for (const [id, marker] of markerRefs.current) {
      if (!seen.has(id)) {
        marker.remove();
        markerRefs.current.delete(id);
      }
    }
  }, [map, markers]);

  return (
    <>
      <div ref={containerRef} className="w-full h-full" />
      {tilesFailed && <Unavailable overlay={config.sovereigntyOverlay} />}
    </>
  );
};

/**
 * Live operational map (MF-04, task 1.3).
 *
 * Leaflet over the tiles and attribution that GET /api/map/config returns, with the Vietnamese
 * sovereignty overlay always drawn on top (D-031). If the config or the tiles fail, the panel shows
 * MSG33 and the rest of the page keeps working.
 */
export const LiveMapWidget: React.FC<{ markers?: MapMarker[] }> = ({ markers = [] }) => {
  const config = useQuery({ queryKey: MAP_CONFIG_KEY, queryFn: getMapConfig, retry: false });

  return (
    <div className="relative w-full h-[500px] rounded-xl overflow-hidden shadow-sm border border-slate-200">
      {config.data && <LeafletMap config={config.data} markers={markers} />}
      {config.isPending && (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">Loading map</p>
      )}
      {config.isError && <Unavailable overlay={[]} />}
    </div>
  );
};
