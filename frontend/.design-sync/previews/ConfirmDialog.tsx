import { ConfirmDialog } from '@treklink/ui';

export const Destructive = () => (
  <ConfirmDialog
    titleId="retire"
    title="Retire device TL-0042?"
    description="The device leaves the fleet and can no longer be rented. This cannot be undone."
    confirmLabel="Retire device"
    destructive
    irreversible
    onConfirm={() => undefined}
    onCancel={() => undefined}
  />
);
