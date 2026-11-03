import { Field, Input, Select, Textarea } from '@treklink/ui';

export const TextInput = () => (
  <div className="max-w-sm">
    <Field id="leader" label="Group leader" hint="As written on the ID card." required>
      <Input id="leader" defaultValue="Nguyễn Minh Anh" aria-describedby="leader-hint" />
    </Field>
  </div>
);

export const WithError = () => (
  <div className="max-w-sm">
    <Field id="phone" label="Emergency phone" error="Enter a Vietnamese mobile number, for example 0912 345 678." required>
      <Input id="phone" defaultValue="12345" invalid aria-describedby="phone-error" />
    </Field>
  </div>
);

export const SelectField = () => (
  <div className="max-w-sm">
    <Field id="route" label="Route">
      <Select id="route" defaultValue="fansipan">
        <option value="fansipan">Fansipan summit, 2 days</option>
        <option value="ta-xua">Tà Xùa dragon spine, 2 days</option>
        <option value="lao-than">Lảo Thẩn, 1 day</option>
      </Select>
    </Field>
  </div>
);

export const Notes = () => (
  <div className="max-w-sm">
    <Field id="notes" label="Handover notes" hint="Visible to station staff only.">
      <Textarea id="notes" defaultValue="Two spare batteries packed. Device TL-0031 has a scratched screen." />
    </Field>
  </div>
);
