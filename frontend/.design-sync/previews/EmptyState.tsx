import { MapPinOff, SearchX } from 'lucide-react';
import { Button, EmptyState } from '@treklink/ui';

export const WithAction = () => (
  <div className="max-w-lg rounded-panel border border-line bg-surface">
    <EmptyState
      title="No contracts yet"
      description="Create the first rental contract to hand devices to a trek group."
      action={<Button variant="primary">Create contract</Button>}
    />
  </div>
);

export const NoResults = () => (
  <div className="max-w-lg rounded-panel border border-line bg-surface">
    <EmptyState icon={<SearchX />} title="No devices match “TL-09”" description="Check the asset tag or clear the search." />
  </div>
);

export const NoPositions = () => (
  <div className="max-w-lg rounded-panel border border-line bg-surface">
    <EmptyState icon={<MapPinOff />} title="No positions in the last hour" />
  </div>
);
