import React from 'react';
import { useNavigate } from 'react-router-dom';
import { TabPanel, Tabs } from '../shared/ui';

export type AuditTab = 'changes' | 'sign-ins';

const ITEMS: { key: AuditTab; label: string }[] = [
  { key: 'changes', label: 'Change log' },
  { key: 'sign-ins', label: 'Sign-ins' },
];

// The strip over the two audit screens (7.4 and 7.3). Each tab is its own route, so a filter set in
// the URL of one never leaks into the other.
export const AuditTabs: React.FC<{ current: AuditTab; children: React.ReactNode }> = ({
  current,
  children,
}) => {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col gap-4">
      <Tabs
        label="Audit"
        idPrefix="audit"
        items={ITEMS}
        value={current}
        onChange={(key) => {
          if (key !== current) navigate(`/t/admin/audit/${key}`);
        }}
      />
      <TabPanel idPrefix="audit" tabKey={current}>
        {children}
      </TabPanel>
    </div>
  );
};
