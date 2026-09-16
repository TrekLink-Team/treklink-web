import React, { useEffect, useRef, useState } from 'react';
import maplibregl, { Map as MapLibreMap, Marker, Popup } from 'maplibre-gl';
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
 */
export const LiveMapWidget: React.FC<{ markers?: MapMarker[] }> = ({ markers = [] }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRefs = useRef<Map<string, Marker>>(new Map());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    try {
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: mapConfig.styleUrl,
        center: mapConfig.center,
        zoom: mapConfig.zoom,
        minZoom: mapConfig.minZoom,
        maxZoom: mapConfig.maxZoom,
        attributionControl: { customAttribution: mapConfig.attribution },
      });

      map.addControl(new maplibregl.NavigationControl(), 'top-right');
      map.on('error', (e) => setError(e.error?.message ?? 'Map failed to load'));
      mapRef.current = map;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Map failed to initialise');
    }

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      markerRefs.current.clear();
    };
  }, []);

  // Reconcile markers against the current set: update in place, add new, remove departed.
  useEffect(() => {
    const map = mapRef.current;
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
  }, [markers]);

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
