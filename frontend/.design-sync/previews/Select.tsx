import { Field, Select } from '@treklink/ui';

export const Default = () => (
  <div className="max-w-sm">
    <Field id="plan" label="Rental plan">
      <Select id="plan" defaultValue="weekend">
        <option value="day">Day trek, 1 day</option>
        <option value="weekend">Weekend, 2 days</option>
        <option value="expedition">Expedition, up to 7 days</option>
      </Select>
    </Field>
  </div>
);

export const Invalid = () => (
  <div className="max-w-sm">
    <Field id="station2" label="Pickup station" error="Choose a station." required>
      <Select id="station2" defaultValue="" invalid>
        <option value="" disabled>Choose a station</option>
        <option value="sapa">Sa Pa</option>
        <option value="mucangchai">Mù Cang Chải</option>
      </Select>
    </Field>
  </div>
);
