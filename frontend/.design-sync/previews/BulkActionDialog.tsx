import { BulkActionDialog } from '@treklink/ui';

const ITEMS = [
  { id: 'd1', label: 'TL-0012' },
  { id: 'd2', label: 'TL-0019' },
  { id: 'd3', label: 'TL-0027' },
];

export const RetireDevices = () => (
  <BulkActionDialog
    title="Retire 3 devices?"
    confirmLabel="Retire 3 devices"
    description="Retired devices leave the fleet and can no longer be rented."
    destructive
    needsReason
    reasonHint="Kept in each device's audit record."
    items={ITEMS}
    run={async () => undefined}
    onClose={() => undefined}
  />
);

export const WithConfirmations = () => (
  <BulkActionDialog
    title="Reset 3 devices?"
    confirmLabel="Reset 3 devices"
    confirmations={['Positions downloaded to the station laptop', 'Devices wiped with the reset key']}
    items={ITEMS}
    run={async () => undefined}
    onClose={() => undefined}
  />
);
