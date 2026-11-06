import React from 'react';
import { DeviceHub } from '../features/device-connector';
import { PageHeader } from '../shared/ui/PageHeader';

// /t/device-hub, screen 4.7 (devices design section 12.13): the Staff device hub page. Connect a unit on
// USB and see one page with everything about it and its maintenance actions. A fit page (chapter 06
// §11.1, ui standard §7): the header and Connect a unit stay, and only the hub's body scrolls.
export const DeviceHubPage: React.FC = () => (
  <section
    aria-labelledby="t-device-hub-title"
    data-fit-page=""
    className="flex min-h-0 flex-1 flex-col"
  >
    <PageHeader
      id="t-device-hub-title"
      title="Device hub"
      description="Connect a unit on USB to see what it reports, its record and what you can do with it."
    />
    <DeviceHub />
  </section>
);
