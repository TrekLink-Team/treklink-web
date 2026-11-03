import { StateChangeMenu } from '@treklink/ui';
import { OpenOnMount } from './_openOnMount';

export const DeviceTransitions = () => (
  <OpenOnMount>
    <StateChangeMenu
      subject="TL-0042"
      version={7}
      onSubmit={async () => undefined}
      transitions={[
        { target: 'MAINTENANCE', label: 'Send to maintenance' },
        { target: 'AVAILABLE', label: 'Mark available' },
        { target: 'RETIRED', label: 'Retire device', destructive: true, description: 'The device leaves the fleet for good.', needsReason: true },
      ]}
    />
  </OpenOnMount>
);
