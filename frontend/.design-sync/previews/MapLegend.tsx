import { MapLegend } from '@treklink/ui';

export const AllStates = () => <MapLegend states={['fresh', 'attention', 'stale', 'unheard', 'sos']} />;

export const Default = () => <MapLegend />;

export const Subset = () => (
  <MapLegend states={['fresh', 'sos']} extra={<span className="text-body-sm text-ink-muted">Positions within 15 min</span>} />
);
