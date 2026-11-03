import { Breadcrumb, Button, PageHeader, StickyPageHeader } from '@treklink/ui';

export const WithHeader = () => (
  <div className="rounded-panel bg-ground" style={{ height: 320, overflowY: 'auto' }}>
    <StickyPageHeader>
      <PageHeader title="Return devices" meta="Contract CT-2026-0142" primaryAction={<Button variant="primary">Confirm return</Button>} />
    </StickyPageHeader>
    <div className="flex flex-col gap-3 px-4 pb-6">
      {['TL-0001', 'TL-0002', 'TL-0003', 'TL-0004', 'TL-0005', 'TL-0006'].map((tag) => (
        <div key={tag} className="rounded-card border border-line bg-surface px-4 py-3 text-body text-ink">{tag} · checked in</div>
      ))}
    </div>
  </div>
);
