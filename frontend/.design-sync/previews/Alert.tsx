import { Alert, Button } from '@treklink/ui';

export const Tones = () => (
  <div className="flex max-w-xl flex-col gap-3">
    <Alert tone="info" title="Sync in progress">Device positions refresh every 30 seconds while the gateway is online.</Alert>
    <Alert tone="success" title="Contract signed">CT-2026-0142 is active. Devices can be handed over at the Sa Pa station.</Alert>
    <Alert tone="warning" title="Battery low on 3 devices">TL-0012, TL-0019 and TL-0027 report under 20 %. Swap them before the next departure.</Alert>
    <Alert tone="error" title="Gateway unreachable">No packets from Fansipan ridge since 14:20. Check the gateway power and uplink.</Alert>
  </div>
);

export const WithAction = () => (
  <div className="max-w-xl">
    <Alert
      tone="warning"
      title="Deposit not received"
      action={<Button size="sm" variant="secondary">Record payment</Button>}
      onDismiss={() => undefined}
    >
      The group leaves tomorrow at 06:00. Devices stay in the station until the deposit is recorded.
    </Alert>
  </div>
);

export const MessageOnly = () => (
  <div className="max-w-xl">
    <Alert tone="info">Filters apply to the whole fleet, not only the current page.</Alert>
  </div>
);
