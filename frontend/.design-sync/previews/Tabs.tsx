import { useState } from 'react';
import { TabPanel, Tabs } from '@treklink/ui';

const ITEMS = [
  { key: 'overview', label: 'Overview' },
  { key: 'devices', label: 'Devices', count: 6 },
  { key: 'payments', label: 'Payments', count: 2 },
  { key: 'history', label: 'History', disabled: true },
] as const;

export const ContractTabs = () => {
  const [tab, setTab] = useState<string>('devices');
  return (
    <div className="max-w-2xl">
      <Tabs label="Contract sections" idPrefix="ct" items={ITEMS as never} value={tab} onChange={setTab} />
      <TabPanel idPrefix="ct" tabKey={tab} className="py-4 text-body text-ink">
        {tab === 'devices' ? 'Six devices handed over at Sa Pa on 2 November.' : 'Contract CT-2026-0142, group Fansipan 14.'}
      </TabPanel>
    </div>
  );
};
