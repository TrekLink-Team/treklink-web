import React, { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl, { Map as MapLibreMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { mapConfig } from '../../shared/config/map';

export interface MapMarker {
  id: string;
  /** [longitude, latitude] — MapLibre order. */
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

/**
 * Live operational map (MF-04).
 *
 * Renders MapLibre GL over whatever provider `shared/config/map.ts` resolves — no vendor is named
 * here (D-012, D-015). If the style fails to load the widget degrades to a visible error state
 * rather than a blank panel (exception scenario E04-6); device and incident panels elsewhere keep
 * working.
 *
 * The map is created in a **callback ref**, not an effect. Creation depends on the DOM node
 * existing, and reporting a failure means setting state — which is what a callback ref is for.
 * Creating it in an effect body would set state synchronously during the effect and trigger
 * cascading renders.
 */
export const LiveMapWidget: React.FC<{ markers?: MapMarker[] }> = ({ markers = [] }) => {
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const markerRefs = useRef<Map<string, Marker>>(new Map());

  const containerRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    try {
      const instance = new maplibregl.Map({
        container: node,
        style: mapConfig.styleUrl,
        center: mapConfig.center,
        zoom: mapConfig.zoom,
        minZoom: mapConfig.minZoom,
        maxZoom: mapConfig.maxZoom,
        attributionControl: { customAttribution: mapConfig.attribution },
      });
      instance.addControl(new maplibregl.NavigationControl(), 'top-right');
      instance.on('error', (e) => setError(e.error?.message ?? 'Map failed to load'));
      setMap(instance);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Map failed to initialise');
    }
  }, []);

  // Tear the map down on unmount. Kept separate from creation so the cleanup closes over the
  // instance that actually exists, and so the ref map is captured rather than read at teardown.
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
        existing.setLngLat(m.position);
        continue;
      }

      const el = document.createElement('div');
      el.className = 'h-3 w-3 rounded-full border-2 border-white shadow';
      el.style.backgroundColor = STATUS_COLOR[m.status ?? 'ok'];
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', `${m.title}${m.subtitle ? `, ${m.subtitle}` : ''}`);

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat(m.position)
        .setPopup(
          new maplibregl.Popup({ offset: 12 }).setHTML(
            `<p class="font-semibold text-sm">${m.title}</p>` +
              (m.subtitle ? `<p class="text-xs text-slate-500">${m.subtitle}</p>` : ''),
          ),
        )
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
    <div className="relative w-full h-[500px] rounded-xl overflow-hidden shadow-sm border border-slate-200">
      <div ref={containerRef} className="w-full h-full" />
      {error && (
        <div
          role="alert"
          className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-slate-50 p-4 text-center"
        >
          <p className="text-sm font-semibold text-slate-700">Map unavailable</p>
          <p className="text-xs text-slate-500">{error}</p>
          <p className="text-xs text-slate-500">
            Device and incident data are unaffected — see the panels alongside.
          </p>
        </div>
      )}
    </div>
  );
};
