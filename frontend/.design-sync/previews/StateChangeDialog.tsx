import { StateChangeDialog } from '@treklink/ui';

export const WithReason = () => (
  <StateChangeDialog
    subject="TL-0042"
    version={7}
    transition={{
      target: 'RETIRED',
      label: 'Retire device',
      destructive: true,
      description: 'The device leaves the fleet and can no longer be rented.',
      needsReason: true,
      reasonHint: 'For example: water damage, lost on the trail.',
    }}
    onSubmit={async () => undefined}
    onClose={() => undefined}
  />
);

export const Simple = () => (
  <StateChangeDialog
    subject="CT-2026-0142"
    version={3}
    transition={{ target: 'ACTIVE', label: 'Activate contract', description: 'Devices can be handed over once the contract is active.' }}
    onSubmit={async () => undefined}
    onClose={() => undefined}
  />
);
