import { useState } from 'react';
import { TabPanel, Tabs } from '@treklink/ui';

export const WithTabs = () => {
  const [tab, setTab] = useState<string>('route');
  return (
    <div className="max-w-xl">
      <Tabs
        label="Trek details"
        idPrefix="trek"
        items={[{ key: 'route', label: 'Route' }, { key: 'group', label: 'Group' }] as never}
        value={tab}
        onChange={setTab}
      />
      <TabPanel idPrefix="trek" tabKey={tab} className="py-4">
        <p className="text-body text-ink">Fansipan summit via Trạm Tôn, 2 days, 1 night at the 2,800 m camp.</p>
        <p className="text-body-sm text-ink-muted">Departure 06:00 from Sa Pa station.</p>
      </TabPanel>
    </div>
  );
};
