import { BulkBar, Button } from '@treklink/ui';

export const Selected = () => (
  <BulkBar
    count={3}
    noun={{ one: 'device', other: 'devices' }}
    actions={
      <>
        <Button size="sm">Send 3 devices to maintenance</Button>
        <Button size="sm" variant="danger">Retire 3 devices</Button>
      </>
    }
    onClear={() => undefined}
  />
);

export const OfferSelectAll = () => (
  <BulkBar
    count={25}
    noun={{ one: 'device', other: 'devices' }}
    actions={<Button size="sm">Export 25 devices</Button>}
    onClear={() => undefined}
    selectAll={{ total: 287, onSelect: () => undefined }}
  />
);
