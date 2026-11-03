import { Field, Input } from '@treklink/ui';

export const Default = () => (
  <div className="flex max-w-sm flex-col gap-4">
    <Field id="tag" label="Asset tag">
      <Input id="tag" defaultValue="TL-0042" />
    </Field>
    <Field id="search" label="Group name">
      <Input id="search" placeholder="For example Fansipan 14" />
    </Field>
  </div>
);

export const States = () => (
  <div className="flex max-w-sm flex-col gap-4">
    <Field id="imei" label="IMEI" error="IMEI must be 15 digits.">
      <Input id="imei" defaultValue="35693803564" invalid />
    </Field>
    <Field id="station" label="Station">
      <Input id="station" defaultValue="Sa Pa" disabled />
    </Field>
  </div>
);
