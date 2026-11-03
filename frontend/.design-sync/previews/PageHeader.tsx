import { Download, Plus } from 'lucide-react';
import { Button, PageHeader } from '@treklink/ui';

export const ListPage = () => (
  <PageHeader
    title="Devices"
    meta="287 devices"
    description="Every TrekLink unit in the fleet, with its status and last report."
    actions={<Button icon={<Download className="h-4 w-4" />}>Export CSV</Button>}
    primaryAction={<Button variant="primary" icon={<Plus className="h-4 w-4" />}>Register device</Button>}
  />
);

export const DetailPage = () => (
  <PageHeader
    title="CT-2026-0142"
    breadcrumb={[{ label: 'Contracts', to: '/contracts' }, { label: 'CT-2026-0142' }]}
    meta="Active since 2 November"
    primaryAction={<Button variant="primary">Record return</Button>}
  />
);
