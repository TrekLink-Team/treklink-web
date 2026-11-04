import React from 'react';
import { DeviceHub } from '../features/device-connector';
import { PageHeader } from '../shared/ui/PageHeader';

// /t/device-hub, screen 4.7 (devices design section 11.13): the Staff device hub page. Connect a unit on
// USB and see one page with everything about it and its maintenance actions.
export const DeviceHubPage: React.FC = () => (
  <section aria-labelledby="t-device-hub-title">
    <PageHeader
      id="t-device-hub-title"
      title="Device hub"
      description="Connect a unit on USB to see what it reports, its record and what you can do with it."
    />
    <DeviceHub />
  </section>
);
