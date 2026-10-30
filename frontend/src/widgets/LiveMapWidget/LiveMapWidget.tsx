import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  MAP_CONFIG_KEY,
  getMapConfig,
  type Basemap,
  type MapConfig,
} from '../../shared/config/map';
import { cn } from '../../shared/ui/cn';
import { markerIcon as systemMarkerIcon } from '../../shared/ui/map/markers';
import type { MarkerState } from '../../shared/ui/status';

export interface MapMarker {
  id: string;
  /** [latitude, longitude], Leaflet order. */
  position: [number, number];
  title: string;
  subtitle?: string;
  /** Drives marker colour; keep in step with device/incident status vocabularies. */
  status?: 'ok' | 'warning' | 'stale' | 'incident';
  /** Extra popup lines under the subtitle, such as battery and last-seen time. */
  details?: string[];
}

// Marker chrome of the TrekLink System (shared/ui/map/markers.ts): shape and colour per state.
const MARKER_STATE: Record<NonNullable<MapMarker['status']>, MarkerState> = {
  ok: 'fresh',
  warning: 'attention',
  stale: 'stale',
  incident: 'sos',
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
    'w-max -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded bg-surface/90 px-2 py-0.5 text-xs font-semibold text-status-critical-fg shadow';
  element.textContent = label;
  return L.divIcon({ html: element, className: '', iconSize: [0, 0] });
};

const markerIcon = (marker: MapMarker): L.DivIcon =>
  systemMarkerIcon({
    state: MARKER_STATE[marker.status ?? 'ok'],
    label: marker.title,
    name: textOf(marker),
    showChip: false,
  });

const popupContent = (marker: MapMarker): HTMLElement => {
  const element = document.createElement('div');
  const title = document.createElement('p');
  title.className = 'font-semibold text-sm';
  title.textContent = marker.title;
  element.append(title);
  for (const line of [marker.subtitle, ...(marker.details ?? [])]) {
    if (!line) continue;
    const text = document.createElement('p');
    text.className = 'text-xs text-ink-muted';
    text.textContent = line;
    element.append(text);
  }
  return element;
};

// What a marker shows besides its position; a change redraws its icon and popup.
const lookOf = (marker: MapMarker): string =>
  JSON.stringify([marker.title, marker.subtitle, marker.status, marker.details]);

const Unavailable: React.FC<{ overlay: MapConfig['sovereigntyOverlay'] }> = ({ overlay }) => (
  <div
    role="alert"
    className="absolute inset-0 z-[800] flex flex-col items-center justify-center gap-1 bg-sunken p-4 text-center"
  >
    <p className="text-body font-semibold text-ink">{MSG33}</p>
    {overlay.length > 0 && (
      <ul className="text-body-sm text-ink-muted">
        {overlay.map((place) => (
          <li key={place.label}>{place.label}</li>
        ))}
      </ul>
    )}
  </div>
);

const LeafletMap: React.FC<{
  config: MapConfig;
  markers: MapMarker[];
  selectedId?: string | null;
}> = ({ config, markers, selectedId }) => {
  const [map, setMap] = useState<L.Map | null>(null);
  const [tilesFailed, setTilesFailed] = useState(false);
  const markerRefs = useRef<Map<string, L.Marker>>(new Map());
  const looks = useRef<Map<string, string>>(new Map());

  // The map is created in a callback ref: creation needs the DOM node, and reporting a tile failure
  // sets state, which an effect body should not do synchronously.
  const containerRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return;
      const { lat, lon, zoom } = config.defaultViewport;
      const instance = L.map(node).setView([lat, lon], zoom);

      // One tile layer per basemap, in the server's order, opening on the default (D-072). Only the
      // active layer is on the map, so only it reports loads and failures.
      const basemaps: Basemap[] = config.basemaps.length
        ? config.basemaps
        : [
            {
              id: config.provider,
              name: config.provider,
              tileUrl: config.tileUrl,
              attribution: config.attribution,
              maxZoom: 18,
              maxNativeZoom: 18,
            },
          ];
      // One failed tile is normal on a flaky link. The panel appears only when a whole batch of tiles
      // finishes without a single success, and goes as soon as one tile loads (REQ-EVT-04).
      let loadedInBatch = 0;
      const layers: Record<string, L.TileLayer> = {};
      for (const basemap of basemaps) {
        const tiles = L.tileLayer(basemap.tileUrl, {
          attribution: basemap.attribution,
          maxZoom: basemap.maxZoom,
          maxNativeZoom: basemap.maxNativeZoom,
        });
        tiles.on('loading', () => {
          loadedInBatch = 0;
        });
        tiles.on('tileload', () => {
          loadedInBatch += 1;
          setTilesFailed(false);
        });
        tiles.on('load', () => {
          if (loadedInBatch === 0) setTilesFailed(true);
        });
        layers[basemap.name] = tiles;
      }
      const initial = basemaps.find((basemap) => basemap.id === config.provider) ?? basemaps[0];
      layers[initial.name].addTo(instance);
      // Base layers only: the sovereignty overlay is never offered for switching off (REQ-UBI-06).
      if (basemaps.length > 1)
        L.control.layers(layers, undefined, { collapsed: false }).addTo(instance);
      instance.on('baselayerchange', () => setTilesFailed(false));

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
    const tracedLooks = looks.current;
    return () => {
      tracked.clear();
      tracedLooks.clear();
      map.remove();
    };
  }, [map]);

  // Reconcile markers against the current set: update in place, add new, remove departed.
  useEffect(() => {
    if (!map) return;
    const seen = new Set<string>();

    for (const m of markers) {
      seen.add(m.id);
      const look = lookOf(m);
      const existing = markerRefs.current.get(m.id);
      if (existing) {
        existing.setLatLng(m.position);
        if (looks.current.get(m.id) !== look) {
          existing.setIcon(markerIcon(m));
          existing.setPopupContent(popupContent(m));
          looks.current.set(m.id, look);
        }
        continue;
      }
      const marker = L.marker(m.position, { icon: markerIcon(m), title: textOf(m), alt: textOf(m) })
        .bindPopup(popupContent(m), { offset: [0, -4] })
        .addTo(map);
      markerRefs.current.set(m.id, marker);
      looks.current.set(m.id, look);
    }

    for (const [id, marker] of markerRefs.current) {
      if (!seen.has(id)) {
        marker.remove();
        markerRefs.current.delete(id);
        looks.current.delete(id);
      }
    }
  }, [map, markers]);

  // A device chosen in a list beside the map: centre on its marker and open its popup.
  useEffect(() => {
    if (!map || !selectedId) return;
    const marker = markerRefs.current.get(selectedId);
    if (!marker) return;
    map.panTo(marker.getLatLng());
    marker.openPopup();
  }, [map, selectedId]);

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
 * Leaflet over the basemaps that GET /api/map/config returns, switchable in a layer control, with the
 * Vietnamese sovereignty overlay always drawn on top of every basemap (D-031, D-072). If the config or the tiles fail, the panel shows
 * MSG33 and the rest of the page keeps working.
 */
export const LiveMapWidget: React.FC<{
  markers?: MapMarker[];
  /** The marker to centre on and open, chosen outside the map (screen 9.1 side panel). */
  selectedId?: string | null;
  /** Size of the map box. The default keeps the interim dashboard's height; a full-bleed map page
   * passes `h-full` inside MapWorkspace. */
  className?: string;
}> = ({ markers = [], selectedId = null, className }) => {
  const config = useQuery({
    queryKey: MAP_CONFIG_KEY,
    queryFn: getMapConfig,
    retry: false,
    // The map is built once from this config; a refetch must not hand it a new one mid-session.
    staleTime: Infinity,
  });

  return (
    <div className={cn('relative h-[500px] w-full overflow-hidden rounded-panel border border-line bg-sunken shadow-raise', className)}>
      {config.data && (
        <LeafletMap
          key={config.data.tileUrl}
          config={config.data}
          markers={markers}
          selectedId={selectedId}
        />
      )}
      {config.isPending && (
        <p className="absolute inset-0 flex items-center justify-center text-body text-ink-muted">
          Loading map
        </p>
      )}
      {config.isError && <Unavailable overlay={[]} />}
    </div>
  );
};
