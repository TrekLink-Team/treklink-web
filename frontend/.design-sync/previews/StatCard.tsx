import { Battery, Radio, Siren, Wallet } from 'lucide-react';
import { StatCard } from '@treklink/ui';

export const Dashboard = () => (
  <div className="grid max-w-3xl grid-cols-2 gap-4">
    <StatCard label="Devices on trek" value="128" hint="Updated 08:14" icon={<Radio />} />
    <StatCard label="Open SOS" value="2" hint="Oldest 12 min ago" tone="critical" icon={<Siren />} href="/incidents" />
    <StatCard label="Low battery" value="9" hint="Under 20 %" tone="attention" icon={<Battery />} />
    <StatCard label="Revenue this month" value="48,500,000 ₫" hint="Up 12 % on October" icon={<Wallet />} />
  </div>
);
