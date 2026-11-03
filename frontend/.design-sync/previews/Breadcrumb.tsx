import { Breadcrumb } from '@treklink/ui';

export const Trail = () => (
  <Breadcrumb items={[{ label: 'Contracts', to: '/contracts' }, { label: 'CT-2026-0142', to: '/contracts/142' }, { label: 'Devices' }]} />
);

export const TwoLevels = () => <Breadcrumb items={[{ label: 'Fleet', to: '/devices' }, { label: 'TL-0042' }]} />;
