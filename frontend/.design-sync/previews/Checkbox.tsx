import { Checkbox } from '@treklink/ui';

export const Options = () => (
  <div className="flex max-w-md flex-col">
    <Checkbox label="Include spare batteries" description="Two batteries per device, charged at handover." defaultChecked />
    <Checkbox label="Send the route to the group leader" />
    <Checkbox label="Insurance already arranged" disabled />
  </div>
);
