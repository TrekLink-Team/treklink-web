import { ConfidenceBadge, MapPanel } from '@treklink/ui';

export const IncidentQueue = () => (
  <div style={{ width: 360 }}>
    <MapPanel title="Incidents" count={2}>
      <ul className="flex flex-col gap-2">
        <li className="flex items-center justify-between rounded-card border border-line bg-surface px-3 py-2">
          <span className="text-body text-ink">SOS · TL-0019</span>
          <ConfidenceBadge confidence="CONFIRMED" />
        </li>
        <li className="flex items-center justify-between rounded-card border border-line bg-surface px-3 py-2">
          <span className="text-body text-ink">No movement · TL-0027</span>
          <ConfidenceBadge confidence="SUSPECTED" />
        </li>
      </ul>
    </MapPanel>
  </div>
);

export const Collapsed = () => (
  <div style={{ width: 360 }}>
    <MapPanel title="Groups on trek" count={5} defaultOpen={false}>
      <p className="text-body text-ink">Five groups.</p>
    </MapPanel>
  </div>
);
