import { Field, Textarea } from '@treklink/ui';

export const Default = () => (
  <div className="max-w-md">
    <Field id="damage" label="Damage description" hint="What happened, and where on the device.">
      <Textarea id="damage" defaultValue="Antenna bent after a fall near the Trạm Tôn pass. Device still transmits." />
    </Field>
  </div>
);

export const Invalid = () => (
  <div className="max-w-md">
    <Field id="reason" label="Reason for cancelling" error="Give a reason of at least 10 characters." required>
      <Textarea id="reason" rows={3} defaultValue="Weather" invalid />
    </Field>
  </div>
);
