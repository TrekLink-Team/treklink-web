import { Button, Drawer, StatusBadge, DEVICE_STATUS } from '@treklink/ui';

// Drawer is position: fixed; the transform makes this frame the page it slides over.
export const DeviceDetails = () => (
  <div style={{ position: 'relative', height: 560, width: 880, transform: 'translateZ(0)' }} className="bg-ground">
  <Drawer
    titleId="dev"
    title="TL-0042"
    side="right"
    onClose={() => undefined}
    footer={<Button variant="secondary">Open device page</Button>}
  >
    <dl className="flex flex-col gap-3 text-body">
      <div><dt className="text-label uppercase text-ink-muted">Status</dt><dd className="mt-1"><StatusBadge entry={DEVICE_STATUS.RENTED} /></dd></div>
      <div><dt className="text-label uppercase text-ink-muted">Model</dt><dd className="text-ink">TrekLink Node v2</dd></div>
      <div><dt className="text-label uppercase text-ink-muted">Last position</dt><dd className="text-ink">Trạm Tôn pass, 14:32</dd></div>
      <div><dt className="text-label uppercase text-ink-muted">Battery</dt><dd className="text-ink">64 %</dd></div>
    </dl>
  </Drawer>
  </div>
);
