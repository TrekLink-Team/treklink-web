import { MapLegend, MapPanel, MapWorkspace } from '@treklink/ui';

// The map slot takes the live Leaflet map in the app; a topographic-tinted block stands in here.
const MapStandIn = () => (
  <div className="relative h-full w-full" style={{ minHeight: 360, background: 'linear-gradient(135deg, #cfe3d4, #eef3e6 40%, #d6e6ee)' }}>
    <MapLegend className="absolute bottom-3 left-3" />
  </div>
);

export const OperationsMap = () => (
  <div style={{ height: 420 }}>
    <MapWorkspace
      map={<MapStandIn />}
      queue={
        <MapPanel title="Incidents" count={1}>
          <p className="px-4 py-3 text-body text-ink">SOS · TL-0019 · Tà Xùa ridge</p>
        </MapPanel>
      }
    />
  </div>
);
